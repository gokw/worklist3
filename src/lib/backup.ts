// ==============================================================
// 自動バックアップ層(File System Access API)
//   localStorage(主保存)はそのまま。その上に「同期フォルダへの控え」を足す。
//     - ミラー      : 変更のたび(デバウンス)に <フォルダ>/worklist3.json を上書き
//     - ローテーション: <フォルダ>/backups/worklist3-YYYY-MM-DD.json を14日分保持
//     - サニティガード: 壊れて空/激減したデータを、無傷の控えへ焼き付けない
//   フォルダ未接続・権限拒否・書き込み失敗でもアプリ本体は動き続ける(付加機能)。
//   対応は Chromium系(Chrome/Edge)。非対応環境では supported=false でUIを隠す。
// ==============================================================
import type { Task } from "../types";
import { serializeTasks } from "./storage";
import { addToDate, nowHHMM, todayStr } from "./date";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  }
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
  }
}

const MIRROR_FILE = "worklist3.json";
const ROTATION_DIR = "backups";
/** ローテーションの世代保持数(日)。これより古い日付のファイルは自動削除 */
const KEEP_DAYS = 14;
/** 連続変更をまとめる待ち時間 */
const DEBOUNCE_MS = 1500;
/** 急減とみなす条件: 前回比50%以上減 かつ 5件以上減 */
const GUARD_DROP_RATIO = 0.5;
const GUARD_DROP_MIN = 5;

export interface BackupState {
  /** File System Access API が使える環境か */
  supported: boolean;
  connected: boolean;
  /** 接続中のフォルダ名 */
  dirName: string;
  /** 最終バックアップ成功時刻(HH:MM)。未実施なら空 */
  lastSuccessAt: string;
  /** 直近のエラー/ガード保留の説明。空なら異常なし */
  problem: string;
  /** 権限切れなどで再接続(ユーザー操作)が必要か */
  needsReconnect: boolean;
}

let state: BackupState = {
  supported: typeof window !== "undefined" && typeof window.showDirectoryPicker === "function",
  connected: false,
  dirName: "",
  lastSuccessAt: "",
  problem: "",
  needsReconnect: false,
};

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
// ディレクトリハンドルの永続化(IndexedDBにハンドル1個だけ。データ本体ではない)
// -------------------------------------------------------------
const IDB_NAME = "worklist3.backup";
const IDB_STORE = "handles";
const IDB_KEY = "backupDir";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRead(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openIdb();
  try {
    return await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbWrite(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
      const req = handle ? store.put(handle, IDB_KEY) : store.delete(IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// -------------------------------------------------------------
// 書き込み
// -------------------------------------------------------------
let dirHandle: FileSystemDirectoryHandle | null = null;
/** 直前に控えへ書けた件数(サニティガードの比較元)。不明なら null=ガードしない */
let lastBackedUpCount: number | null = null;

async function ensurePermission(
  dir: FileSystemDirectoryHandle,
  interactive: boolean
): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  try {
    if ((await dir.queryPermission?.(opts)) === "granted") return true;
    // 再許可はユーザー操作起点でないとブラウザに弾かれるため、起動時は求めない
    if (!interactive) return false;
    return (await dir.requestPermission?.(opts)) === "granted";
  } catch {
    return false;
  }
}

/**
 * JSONを1ファイル書く。
 * createWritable() は一時ファイル(スワップ)へ書き、close() で初めて本体へ差し替える
 * 仕様のため、同期途中の半端な内容が正式ファイルに現れることはない(原子的書き込み)。
 */
async function writeJson(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
}

/** 既存ミラーの件数を読む(ガードの比較元の初期値)。無い/壊れていれば null */
async function readMirrorCount(dir: FileSystemDirectoryHandle): Promise<number | null> {
  try {
    const file = await (await dir.getFileHandle(MIRROR_FILE)).getFile();
    const parsed = JSON.parse(await file.text());
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/**
 * サニティガード: 書こうとしているデータが「壊れた結果の空/激減」でないか。
 * 上書きしてはいけない場合、その理由を返す(問題なければ空文字)。
 */
function guardReason(count: number): string {
  const prev = lastBackedUpCount;
  if (prev === null || prev === 0) return ""; // 比較元が無いので判定しない
  if (count === 0)
    return `タスクが0件になったため、バックアップへの上書きを保留しました(控えは${prev}件のまま)`;
  const dropped = prev - count;
  if (dropped >= GUARD_DROP_MIN && dropped >= prev * GUARD_DROP_RATIO)
    return `${prev}件→${count}件と急減したため、バックアップへの上書きを保留しました(控えは${prev}件のまま)`;
  return "";
}

/**
 * 保持期間を過ぎた日次コピーを消す。worklist3-YYYY-MM-DD.json 以外は触らない。
 * これは後片付けなので、1件消せなくても残りは続行する
 * (既に消えていた=NotFoundError は目的が達成済みなので無視)。
 */
async function sweepRotation(dir: FileSystemDirectoryHandle): Promise<void> {
  const backups = await dir.getDirectoryHandle(ROTATION_DIR, { create: true });
  const oldestKept = addToDate(todayStr(), "day", -(KEEP_DAYS - 1));
  for await (const name of backups.keys()) {
    const m = /^worklist3-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (!m || m[1] >= oldestKept) continue;
    try {
      await backups.removeEntry(name);
    } catch (e) {
      if ((e as DOMException)?.name !== "NotFoundError")
        console.error(`古い世代 ${name} を消せませんでした`, e);
    }
  }
}

/** 実行中の掃除。起動時の掃除と書き込み後の掃除が重なっても1回にまとめる */
let sweeping: Promise<void> | null = null;

function cleanupRotation(dir: FileSystemDirectoryHandle): Promise<void> {
  if (!sweeping) {
    sweeping = sweepRotation(dir).finally(() => {
      sweeping = null;
    });
  }
  return sweeping;
}

/** ミラー+日次コピーを書く。force=true でサニティガードを無視(ユーザーの明示操作) */
async function writeBackup(tasks: Task[], force: boolean): Promise<void> {
  const dir = dirHandle;
  if (!dir) return;

  const reason = force ? "" : guardReason(tasks.length);
  if (reason) {
    setState({ problem: reason });
    notify(`⚠ ${reason}`);
    return;
  }

  try {
    if (!(await ensurePermission(dir, false))) {
      setState({
        problem: "バックアップ先の権限が切れています。💾メニューから再接続してください",
        needsReconnect: true,
      });
      notify("⚠ バックアップ先の権限が切れています。💾メニューから再接続してください");
      return;
    }
    const text = serializeTasks(tasks);
    await writeJson(dir, MIRROR_FILE, text);
    const backups = await dir.getDirectoryHandle(ROTATION_DIR, { create: true });
    await writeJson(backups, `worklist3-${todayStr()}.json`, text);
    // ここまで来れば控えは取れている。以降の失敗で「失敗」と報告しない
    lastBackedUpCount = tasks.length;
    setState({ lastSuccessAt: nowHHMM(), problem: "", needsReconnect: false });
    await cleanupRotation(dir).catch((e) =>
      console.error("古い世代の掃除に失敗しました", e)
    );
  } catch (e) {
    console.error("バックアップの書き込みに失敗しました", e);
    setState({ problem: "バックアップの書き込みに失敗しました" });
    notify("⚠ バックアップの書き込みに失敗しました");
  }
}

// -------------------------------------------------------------
// デバウンス + 直列化
// -------------------------------------------------------------
let flushTimer: number | undefined;
let pending: Task[] | null = null;
let writing = false;

async function flush(): Promise<void> {
  if (writing || !dirHandle || !pending) return; // 前の書き込みが終わるまで待つ
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
  if (!dirHandle) return;
  pending = tasks;
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
}

/** ユーザーの明示操作による即時バックアップ。ガード保留を解除する手段でもある */
export async function backupNow(tasks: Task[]): Promise<void> {
  if (!dirHandle) return;
  window.clearTimeout(flushTimer);
  pending = null;
  await writeBackup(tasks, true);
  if (!state.problem) notify(`バックアップしました(${tasks.length}件)`);
}

// -------------------------------------------------------------
// 接続・再接続・解除
// -------------------------------------------------------------
async function attach(
  dir: FileSystemDirectoryHandle,
  tasks: Task[],
  interactive: boolean
): Promise<boolean> {
  if (!(await ensurePermission(dir, interactive))) {
    dirHandle = null;
    setState({
      connected: false,
      dirName: dir.name,
      needsReconnect: true,
      problem: "バックアップ先の権限がありません。再接続してください",
    });
    return false;
  }
  dirHandle = dir;
  lastBackedUpCount = await readMirrorCount(dir);
  setState({ connected: true, dirName: dir.name, needsReconnect: false, problem: "" });
  try {
    await cleanupRotation(dir); // 起動時の世代クリーンアップ
  } catch (e) {
    console.error("古い世代の掃除に失敗しました", e);
  }
  notifyTasksChanged(tasks);
  return true;
}

/** バックアップ先フォルダを選ぶ(ユーザー操作起点) */
export async function chooseBackupDir(tasks: Task[]): Promise<void> {
  if (!window.showDirectoryPicker) return;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return; // ユーザーがキャンセルした
  }
  if (await attach(dir, tasks, true)) {
    await idbWrite(dir).catch((e) => console.error("バックアップ先の記憶に失敗しました", e));
    notify(`バックアップ先を設定しました: ${dir.name}`);
  }
}

/** 起動時にバックアップ先を復元する。権限が切れていれば再接続を促すだけ */
export async function restoreBackupDir(tasks: Task[]): Promise<void> {
  if (!state.supported) return;
  try {
    const dir = await idbRead();
    if (!dir) return;
    await attach(dir, tasks, false);
  } catch (e) {
    console.error("バックアップ先の復元に失敗しました", e);
  }
}

/** 権限切れからの再接続(ユーザー操作起点なので requestPermission を出せる) */
export async function reconnectBackupDir(tasks: Task[]): Promise<void> {
  let dir = dirHandle;
  if (!dir) dir = (await idbRead().catch(() => undefined)) ?? null;
  if (!dir) {
    await chooseBackupDir(tasks);
    return;
  }
  if (await attach(dir, tasks, true)) notify(`バックアップ先へ再接続しました: ${dir.name}`);
}

/** 接続を解除する(フォルダの中身は消さない) */
export async function disconnectBackupDir(): Promise<void> {
  dirHandle = null;
  lastBackedUpCount = null;
  pending = null;
  window.clearTimeout(flushTimer);
  await idbWrite(null).catch((e) => console.error("バックアップ先の解除に失敗しました", e));
  setState({
    connected: false,
    dirName: "",
    lastSuccessAt: "",
    problem: "",
    needsReconnect: false,
  });
}
