// ==============================================================
// 自動バックアップ層(方針)
//   localStorage(主保存)はそのまま。その上に「控え」を足す。
//     - ミラー      : 変更のたび(デバウンス)に最新の全件を1ファイルへ上書き
//     - ローテーション: 日次コピーを14日分保持し、古いものは自動削除
//     - サニティガード: 壊れて空/激減したデータを、無傷の控えへ焼き付けない
//   未接続・権限拒否・書き込み失敗でもアプリ本体は動き続ける(付加機能)。
//
//   「どこへ、どう書くか」は BackupTarget(backupTargets/)へ委譲する。
//   ここに残るのは保存先によらない方針だけなので、フェイクの保存先を差せば
//   デバウンス・ガード・ローテーション判定を単体テストできる。
// ==============================================================
import type { Task } from "../types";
import { serializeTasks } from "./storage";
import { addToDate, nowHHMM, todayStr } from "./date";
import type { BackupBody, BackupTarget, BackupTargetId, ConnectResult } from "./backupTargets/types";
import { FsaBackupTarget } from "./backupTargets/fsa";

/** ローテーションの世代保持数(日)。これより古い日付のファイルは自動削除 */
const KEEP_DAYS = 14;
/** 急減とみなす条件: 前回比50%以上減 かつ 5件以上減 */
const GUARD_DROP_RATIO = 0.5;
const GUARD_DROP_MIN = 5;

export interface BackupState {
  /** 現在の保存先が、この環境で使えるか */
  supported: boolean;
  connected: boolean;
  /** 現在の保存先(ローカルフォルダ / Googleドライブ) */
  targetId: BackupTargetId;
  targetLabel: string;
  /** 接続先の表示名(フォルダ名 / 端末名) */
  dirName: string;
  /** 最終バックアップ成功時刻(HH:MM)。未実施なら空 */
  lastSuccessAt: string;
  /** 直近のエラー/ガード保留の説明。空なら異常なし */
  problem: string;
  /** 権限切れなどで再接続(ユーザー操作)が必要か */
  needsReconnect: boolean;
  /**
   * 圏外・オフラインで未送信の控えを抱えているか。
   * 移動のたびに警告を出すと実用に耐えないため、これは異常として扱わない。
   */
  offline: boolean;
  /** 警告を一時停止している期限(ms)。0=停止していない。Issue #20 */
  snoozedUntil: number;
}

// -------------------------------------------------------------
// 保存先
// -------------------------------------------------------------
const fsaTarget = new FsaBackupTarget();
const targets: Partial<Record<BackupTargetId, BackupTarget>> = {
  fsa: fsaTarget,
  // gdrive は後続で追加する
};

let current: BackupTarget = fsaTarget;

/** 登録済みの保存先(UIの選択肢。非対応の環境のものも含む) */
export function backupTargets(): BackupTarget[] {
  return Object.values(targets).filter((t): t is BackupTarget => Boolean(t));
}

/** サニティガードの比較元は保存先ごとに持つ(切り替えで比較元がずれないように) */
const lastBackedUpCount = new Map<BackupTargetId, number | null>();

function prevCount(): number | null {
  return lastBackedUpCount.get(current.id) ?? null;
}

let state: BackupState = {
  supported: current.supported,
  connected: false,
  targetId: current.id,
  targetLabel: current.label,
  dirName: "",
  lastSuccessAt: "",
  problem: "",
  needsReconnect: false,
  offline: false,
  snoozedUntil: 0,
};

/**
 * バックアップが要注意状態か(スヌーズは考慮しない、生の異常判定)。Issue #20
 * 権限切れ、または接続中なのに書き込み失敗/ガード保留が起きている状態。
 * オフラインは復帰すれば自然に解消するので、異常には数えない。
 */
export function backupNeedsAttention(s: BackupState): boolean {
  return s.needsReconnect || (s.connected && s.problem !== "");
}

const listeners = new Set<(s: BackupState) => void>();

export function getBackupState(): BackupState {
  return state;
}

/** 状態変化の購読(App が state へ写して Toolbar に渡す) */
export function subscribeBackup(fn: (s: BackupState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(patch: Partial<BackupState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

/** トースト通知の差し込み口(App の showToast を繋ぐ) */
let notify: (msg: string) => void = () => {};
export function setBackupNotifier(fn: (msg: string) => void): void {
  notify = fn;
}

// -------------------------------------------------------------
// 警告の停止(スヌーズ)。Issue #20。メモリのみ=リロードで解除
// -------------------------------------------------------------
let snoozeUntil = 0;
let snoozeTimer: number | undefined;
/** 異常を1度トーストしたら success まで繰り返さない(書き込み毎の連発を防ぐ) */
let warned = false;

/** 異常を状態へ反映し、スヌーズ中でなく未通知なら1度だけトーストする */
function reportProblem(problem: string, extra?: Partial<BackupState>): void {
  setState({ problem, ...extra });
  if (!warned && Date.now() >= snoozeUntil) notify(`⚠ ${problem}`);
  warned = true;
}

/** ◯分だけ警告を止める(15/30/60分を想定)。期限が来たら状態を更新して警告を出し直す */
export function snoozeBackupWarning(minutes: number): void {
  snoozeUntil = Date.now() + minutes * 60_000;
  setState({ snoozedUntil: snoozeUntil });
  window.clearTimeout(snoozeTimer);
  snoozeTimer = window.setTimeout(() => {
    snoozeUntil = 0;
    setState({ snoozedUntil: 0 });
    warned = false;
  }, minutes * 60_000);
}

export function clearBackupSnooze(): void {
  snoozeUntil = 0;
  window.clearTimeout(snoozeTimer);
  setState({ snoozedUntil: 0 });
  warned = false;
}

// -------------------------------------------------------------
// サニティガード
// -------------------------------------------------------------
/**
 * 書こうとしているデータが「壊れた結果の空/激減」でないか。
 * 上書きしてはいけない場合、その理由を返す(問題なければ空文字)。
 */
export function guardReason(count: number, prev: number | null): string {
  if (prev === null || prev === 0) return ""; // 比較元が無いので判定しない
  if (count === 0)
    return `タスクが0件になったため、バックアップへの上書きを保留しました(控えは${prev}件のまま)`;
  const dropped = prev - count;
  if (dropped >= GUARD_DROP_MIN && dropped >= prev * GUARD_DROP_RATIO)
    return `${prev}件→${count}件と急減したため、バックアップへの上書きを保留しました(控えは${prev}件のまま)`;
  return "";
}

// -------------------------------------------------------------
// ローテーション
// -------------------------------------------------------------
/** 保持期間を過ぎた日次コピーを選ぶ。規約外のファイル名は listDaily が弾いている */
export function expiredDailyDates(dates: string[], today: string, keepDays = KEEP_DAYS): string[] {
  const oldestKept = addToDate(today, "day", -(keepDays - 1));
  return dates.filter((d) => d < oldestKept);
}

/** 実行中の掃除。起動時の掃除と書き込み後の掃除が重なっても1回にまとめる */
let sweeping: Promise<void> | null = null;

async function sweepRotation(): Promise<void> {
  const entries = await current.listDaily();
  const expired = new Set(expiredDailyDates(entries.map((e) => e.date), todayStr()));
  for (const e of entries) {
    if (!expired.has(e.date)) continue;
    // 後片付けなので、1件消せなくても残りは続行する
    try {
      await current.deleteDaily(e);
    } catch (err) {
      console.error(`古い世代 ${e.name} を消せませんでした`, err);
    }
  }
}

function cleanupRotation(): Promise<void> {
  if (!sweeping) {
    sweeping = sweepRotation().finally(() => {
      sweeping = null;
    });
  }
  return sweeping;
}

// -------------------------------------------------------------
// 書き込み
// -------------------------------------------------------------
function bodyOf(tasks: Task[]): BackupBody {
  return {
    count: tasks.length,
    toJson: (pretty: boolean) => serializeTasks(tasks, pretty),
  };
}

/** ネットワーク起因の失敗か(オフライン扱いにしてよいか) */
function isOffline(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError; // fetch のネットワークエラー
}

/** ミラー+日次コピーを書く。force=true でサニティガードを無視(ユーザーの明示操作) */
async function writeBackup(tasks: Task[], force: boolean): Promise<void> {
  if (!state.connected) return;

  const reason = force ? "" : guardReason(tasks.length, prevCount());
  if (reason) {
    reportProblem(reason);
    return;
  }

  try {
    if (!(await current.ensureWritable())) {
      reportProblem("バックアップ先の権限が切れています。💾メニューから再接続してください", {
        needsReconnect: true,
      });
      return;
    }
    const body = bodyOf(tasks);
    await current.writeMirror(body);
    await current.writeDaily(body, todayStr());
    // ここまで来れば控えは取れている。以降の失敗で「失敗」と報告しない
    lastBackedUpCount.set(current.id, tasks.length);
    warned = false; // 成功したら次の異常はまた1度通知する
    setState({ lastSuccessAt: nowHHMM(), problem: "", needsReconnect: false, offline: false });
    await cleanupRotation().catch((e) => console.error("古い世代の掃除に失敗しました", e));
  } catch (e) {
    if (isOffline(e)) {
      // 圏外は異常ではない。復帰時に自動で書き直すので、警告は出さず状態だけ示す
      setState({ offline: true });
      return;
    }
    console.error("バックアップの書き込みに失敗しました", e);
    reportProblem("バックアップの書き込みに失敗しました");
  }
}

// -------------------------------------------------------------
// デバウンス + 直列化
// -------------------------------------------------------------
let flushTimer: number | undefined;
let pending: Task[] | null = null;
let writing = false;

async function flush(): Promise<void> {
  if (writing || !state.connected || !pending) return; // 前の書き込みが終わるまで待つ
  const tasks = pending;
  pending = null;
  writing = true;
  try {
    await writeBackup(tasks, false);
  } finally {
    writing = false;
    if (pending) void flush(); // 書き込み中に来た変更を拾う
  }
}

/** タスクが変わったことを知らせる(App の保存useEffectから呼ぶ)。非同期・非ブロッキング */
export function notifyTasksChanged(tasks: Task[]): void {
  if (!state.connected) return;
  pending = tasks;
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), current.debounceMs);
}

/** ユーザーの明示操作による即時バックアップ。ガード保留を解除する手段でもある */
export async function backupNow(tasks: Task[]): Promise<void> {
  if (!state.connected) return;
  window.clearTimeout(flushTimer);
  pending = null;
  await writeBackup(tasks, true);
  if (!state.problem) notify(`バックアップしました(${tasks.length}件)`);
}

/**
 * 画面を離れるとき(タブ非表示・ページ離脱)に、溜まっている変更を書き切る。
 * スマートフォンでは「アプリを離れて端末を置く」が典型的な離脱なので、
 * ここで書ければ実質的な損失窓はほぼ消える。
 * ただしページ破棄中の書き込みは完了が保証されないため、デバウンスの併用は続ける。
 */
export function flushBackupNow(): void {
  if (!state.connected || !pending) return;
  window.clearTimeout(flushTimer);
  void flush();
}

// -------------------------------------------------------------
// 接続・再接続・解除
// -------------------------------------------------------------
async function applyConnect(r: ConnectResult, tasks: Task[]): Promise<boolean> {
  if (!r.ok) {
    setState({
      connected: false,
      dirName: r.displayName,
      needsReconnect: r.needsReconnect ?? false,
      problem: r.problem ?? "",
    });
    return false;
  }
  // 接続時に既存ミラーの件数を読み、サニティガードの比較元にする。
  // これが「localStorageが飛んで0件の状態で接続 → 良い控えを0件で潰す」を止める。
  lastBackedUpCount.set(current.id, await current.readMirrorCount());
  setState({
    connected: true,
    dirName: r.displayName,
    needsReconnect: false,
    problem: "",
    offline: false,
  });
  try {
    await cleanupRotation(); // 起動時の世代クリーンアップ
  } catch (e) {
    console.error("古い世代の掃除に失敗しました", e);
  }
  notifyTasksChanged(tasks);
  return true;
}

/** バックアップ先を選ぶ(ユーザー操作起点) */
export async function chooseBackupDir(tasks: Task[]): Promise<void> {
  const r = await current.connect();
  if (await applyConnect(r, tasks)) notify(`バックアップ先を設定しました: ${r.displayName}`);
}

/** 起動時にバックアップ先を復元する。権限が切れていれば再接続を促すだけ */
export async function restoreBackupDir(tasks: Task[]): Promise<void> {
  if (!current.supported) return;
  await applyConnect(await current.restore(), tasks);
}

/** 権限切れからの再接続(ユーザー操作起点なので再要求を出せる) */
export async function reconnectBackupDir(tasks: Task[]): Promise<void> {
  const r = await current.reconnect();
  if (await applyConnect(r, tasks)) notify(`バックアップ先へ再接続しました: ${r.displayName}`);
}

/** 接続を解除する(保存先の中身は消さない) */
export async function disconnectBackupDir(): Promise<void> {
  await current.disconnect();
  lastBackedUpCount.set(current.id, null);
  pending = null;
  window.clearTimeout(flushTimer);
  setState({
    connected: false,
    dirName: "",
    lastSuccessAt: "",
    problem: "",
    needsReconnect: false,
    offline: false,
  });
}

// -------------------------------------------------------------
// オフラインからの復帰
// -------------------------------------------------------------
if (typeof window !== "undefined") {
  // 圏外の間に溜めた最新スナップショットを、回線が戻ったら書き直す。
  // pending は最新の1件だけを持つ設計なので、差分を積み上げる必要はない。
  window.addEventListener("online", () => {
    if (state.connected && pending) void flush();
  });
}
