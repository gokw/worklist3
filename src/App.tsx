// ==============================================================
// worklist3 アプリ本体
//   状態管理・フィルタ・ショートカットキー・各ダイアログの制御
// ==============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DoneFilter, LayoutMode, Task, TaskScope, ViewMode, WorkMode } from "./types";
import { WORK_MODE_LABELS } from "./types";
import { addToDate, formatDateJa, formatMin, nowHHMM, todayStr } from "./lib/date";
import {
  actMin,
  collectCategories,
  copyTask,
  createTask,
  createWaitCopy,
  derivedStatus,
  endTask,
  interruptTask,
  lastEndTimeOfDay,
  planEnd,
  postponeTask,
  remainMin,
  suggestCategoryByTitle,
  setSequentialStart,
  startTask,
  toggleWaiting,
} from "./lib/logic";
import { parseClipboardText } from "./lib/clipboard";
import { sortTasks } from "./lib/sort";
import { exportTasksAsJson, migrateTask, repository, tasksToCsv } from "./lib/storage";
import {
  type BackupState,
  backupNow,
  chooseBackupDir,
  clearBackupSnooze,
  disconnectBackupDir,
  getBackupState,
  notifyTasksChanged,
  reconnectBackupDir,
  restoreBackupDir,
  setBackupNotifier,
  snoozeBackupWarning,
  subscribeBackup,
} from "./lib/backup";
import { readUrlSettings, writeUrlSettings } from "./lib/urlParams";
import {
  getWriterState,
  requestTakeover,
  setOnPromote,
  startWriterLock,
  subscribeWriter,
} from "./lib/writerLock";
import Toolbar from "./components/Toolbar";
import TaskTable, {
  EDIT_ORDER,
  type EditableField,
  type EditingCell,
} from "./components/TaskTable";
// カード形式は一覧から外した(types.ts 参照)。戻すときはこの import と下の描画分岐を復活させる
// import TaskCards from "./components/TaskCards";
import TaskForm from "./components/TaskForm";
import ShortcutHelpDialog from "./components/ShortcutHelpDialog";
import CalendarSyncResultDialog from "./components/CalendarSyncResultDialog";
import { syncTasksToCalendar, type SyncSummary } from "./lib/gcalMap";
import { acquireToken, createGoogleCalendarClient, loadGcalConfig, resetGcalAuth } from "./lib/gcalClient";
import InterruptDialog from "./components/InterruptDialog";
import TimeInputDialog from "./components/TimeInputDialog";
import BulkEditDialog, { type BulkChanges } from "./components/BulkEditDialog";
import BulkAddDialog from "./components/BulkAddDialog";
import ImportResultDialog, { type ImportResult } from "./components/ImportResultDialog";
import type { ParsedRow } from "./lib/bulkParse";

// URLクエリ → localStorage → 既定 の順に初期値を決める(Issue #4)
const urlInit = readUrlSettings();

/** undoできる窓の長さ(ms)。トースト表示中=この間だけ元に戻せる。Issue #14 */
const UNDO_WINDOW_MS = 6000;

/**
 * クリップボードをプレーン/リッチの両方で読む。
 * read() はブラウザ・権限によっては使えないので、その場合は readText() へ落とす。
 */
async function readClipboard(): Promise<{ text: string; html?: string }> {
  try {
    const items = await navigator.clipboard.read();
    let text = "";
    let html: string | undefined;
    for (const item of items) {
      if (!text && item.types.includes("text/plain"))
        text = await (await item.getType("text/plain")).text();
      if (!html && item.types.includes("text/html"))
        html = await (await item.getType("text/html")).text();
    }
    if (text || html) return { text, html };
  } catch {
    /* read() が使えない環境・形式 → 下の readText() で取り直す */
  }
  return { text: await navigator.clipboard.readText() };
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => repository.load());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  // 標準は「今日以降」。URLで上書き可
  const [viewMode, setViewMode] = useState<ViewMode>(urlInit.view ?? "todayOnward");
  /** カスタム(範囲指定)ビューの開始日・終了日。空=その側は無制限 */
  const [customFrom, setCustomFrom] = useState(urlInit.from ?? "");
  const [customTo, setCustomTo] = useState(urlInit.to ?? "");
  // 表示形式は「表ライト」固定。表形式/カード形式は一覧から外した(types.ts 参照)
  const [layout] = useState<LayoutMode>("tableLight");
  const [categoryFilter, setCategoryFilter] = useState(urlInit.category ?? "");
  // 完了の扱い(すべて/完了のみ/完了を隠す)。標準は「すべて」。URLで上書き可
  const [doneFilter, setDoneFilter] = useState<DoneFilter>(urlInit.done ?? "all");
  /** 予定のみ(開始予定時刻が入ったものだけ)。標準はオフ */
  const [plannedOnly, setPlannedOnly] = useState(urlInit.planned ?? false);
  /** タスク名フィルタ。中間一致。/パターン/ で囲うと正規表現 */
  const [titleFilter, setTitleFilter] = useState(urlInit.q ?? "");
  // 選択したタスクID。選択した順を保つため配列で持つ(連続時刻を選択順に設定するため)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** キーボード操作のカーソル位置(Excel版のアクティブセル行に相当) */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** カーソルの列(Excel風セル移動)。null=行のみ選択 */
  const [focusedField, setFocusedField] = useState<EditableField | null>(null);
  /** 範囲選択の基準行(Shift+クリック / Shift+↑↓ の起点)。Issue #8 */
  const [anchorId, setAnchorId] = useState<string | null>(null);
  /** 表の編集中セル(キーボードからも開始できるよう App が保持) */
  const [editingCell, setEditingCell] = useState<EditingCell>(null);

  // 仕事/個人モード。URL > 前回のモード > すべて
  const [mode, setMode] = useState<WorkMode>(() => {
    if (urlInit.mode) return urlInit.mode;
    const saved = localStorage.getItem("worklist3.mode");
    return saved === "work" || saved === "personal" ? saved : "all";
  });

  // ダイアログ状態
  const [formTask, setFormTask] = useState<Task | null>(null);
  const [formIsNew, setFormIsNew] = useState(true);
  const [interruptTarget, setInterruptTarget] = useState<Task | null>(null);
  const [startTarget, setStartTarget] = useState<Task | null>(null);
  const [endTarget, setEndTarget] = useState<Task | null>(null);
  const [seqOpen, setSeqOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  /** ショートカット一覧(?キー) */
  const [helpOpen, setHelpOpen] = useState(false);
  /** カレンダー登録の結果 */
  const [calSyncResult, setCalSyncResult] = useState<SyncSummary | null>(null);
  /** カレンダー登録の実行中フラグ(連打による二重登録を防ぐ。Issue #29) */
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  /** state更新を待たずに二重起動を弾くための即時ガード(Issue #29) */
  const syncingCalendarRef = useRef(false);
  /**
   * トースト。action で右側のボタン(とキーボード操作)を出し分ける(Issue #14 / #39)。
   *   "undo" … 「↩ 元に戻す」(Ctrl+Z)  "redo" … 「↪ やり直す」(Ctrl+Y)  null … ボタンなし
   */
  const [toast, setToast] = useState<{ text: string; action: "undo" | "redo" | null } | null>(null);
  const [backupState, setBackupState] = useState<BackupState>(getBackupState);
  /** 単一書き手ロック(#57): この窓が書き手(編集可)か。false=読み取り専用 */
  const [isPrimary, setIsPrimary] = useState<boolean>(() => getWriterState().isPrimary);
  /** 保存useEffectなど同期的に判定したい箇所のための最新値 */
  const isPrimaryRef = useRef(isPrimary);
  /** 起動直後の読み取り専用フラッシュでバナーが点滅しないよう、少し待ってからUIを出す(#57 §5-D) */
  const [roleSettled, setRoleSettled] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  /** 起動時1回だけ走る副作用から最新のタスクを見るための控え */
  const tasksRef = useRef(tasks);
  /** カーソル位置の最新値(undoスナップショットで参照) */
  const focusedIdRef = useRef<string | null>(null);
  /** revealTask で案内する行。一覧に現れたらスクロールする */
  const pendingRevealId = useRef<string | null>(null);
  /**
   * 完了・延期など「カーソル位置のタスクが一覧から消える操作」の後始末用(Issue #36 と同種)。
   * 操作前に隣の行を控えておき、対象が実際に一覧から消えたら隣へカーソルを送る。
   * (対象が表示に残るなら=同一IDのまま自動追従するので何もしない)
   */
  const pendingRefocus = useRef<{ leavingId: string; neighborId: string | null } | null>(null);
  /**
   * 直前の操作のスナップショット(単段・自動確定のundo。Issue #14)。
   * 次の操作をすると確定(=消える)。窓(トースト表示中)だけ元に戻せる。
   */
  const pendingUndo = useRef<{ tasks: Task[]; focusedId: string | null; label: string } | null>(
    null
  );
  /**
   * やり直し(redo)用の控え。Ctrl+Z で戻した「操作後」の状態をここに保持し、
   * Ctrl+Y で復元する。窓が閉じる/次の操作でクリア(Issue #39)。
   */
  const pendingRedo = useRef<{ tasks: Task[]; focusedId: string | null; label: string } | null>(
    null
  );
  const undoTimer = useRef<number | undefined>(undefined);
  /**
   * Ctrl+H/K/Lで日付を動かしている間の「見た目の並び固定」(Issue #14 追加)。
   * order = ずらす前の表示順のid列。窓が閉じるまでこの順で描画し、閉じたら整列＋中央寄せ。
   */
  // 日付移動(Ctrl+H/K/L)のセッション。key=窓の識別(単体はタスクID / 一括は "bulk")、
  // order=ずらす前の並び(固定表示用)、focusId=開始時のカーソル(離れたら整列)。
  const [dateShift, setDateShift] = useState<{
    key: string;
    order: string[];
    focusId: string | null;
  } | null>(null);
  const dateShiftTimer = useRef<number | undefined>(undefined);

  // 保存(タスクが変わるたびに localStorage へ)。
  // 同期フォルダへの控えはデバウンス付きの非同期なので、この主経路は止めない
  useEffect(() => {
    tasksRef.current = tasks;
    // 読み取り専用の窓は localStorage にもバックアップにも一切書かない(#57 §4.3)。
    // これが「古いスナップショットによる後勝ち上書き=巻き戻り」を止める最終防衛線。
    if (!isPrimaryRef.current) return;
    repository.save(tasks);
    notifyTasksChanged(tasks);
  }, [tasks]);

  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);

  useEffect(() => {
    localStorage.setItem("worklist3.mode", mode);
  }, [mode]);

  // 現在の表示状態をURLへ反映(ブックマーク・共有できるように)。Issue #4
  useEffect(() => {
    writeUrlSettings({
      mode,
      view: viewMode,
      done: doneFilter,
      planned: plannedOnly,
      category: categoryFilter,
      q: titleFilter,
      from: customFrom,
      to: customTo,
    });
  }, [mode, viewMode, doneFilter, plannedOnly, categoryFilter, titleFilter, customFrom, customTo]);

  /** undoできる操作のトーストは、元に戻せる窓(UNDO_WINDOW_MS)と同じ長さ出す */
  const showToast = useCallback((msg: string, undoable = false) => {
    setToast({ text: msg, action: undoable ? "undo" : null });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      undoable ? UNDO_WINDOW_MS : 3000
    );
  }, []);

  /** undo/redo のトーストを出し、表示中の窓を延長する(Ctrl+Z/Y で行き来できる間だけ出す) */
  const showUndoToast = useCallback((text: string, action: "undo" | "redo") => {
    setToast({ text, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), UNDO_WINDOW_MS);
  }, []);

  /** 読み取り専用の窓で編集操作を弾く。編集系ハンドラの先頭で呼ぶ(#57 §4.5)。 */
  const ensureWritable = useCallback(() => {
    if (isPrimaryRef.current) return true;
    showToast("この窓は読み取り専用です。上部の〔この窓で編集〕で切り替えてください");
    return false;
  }, [showToast]);

  // ---------- undo(単段・自動確定)。Issue #14 ----------
  /**
   * 保留中のundoを確定(=もう戻せない)。あらゆる変更操作の頭で呼び、直前分を確定する。
   * 日付移動(Ctrl+H/K/L)の並び固定セッションも一緒に終わらせ(=整列に戻る)、undoトーストも下げる。
   */
  const commitPendingUndo = useCallback(() => {
    pendingUndo.current = null;
    pendingRedo.current = null; // 次の操作をしたら「やり直し」も無効(#39)
    window.clearTimeout(undoTimer.current);
    window.clearTimeout(dateShiftTimer.current);
    setDateShift(null);
    setToast((prev) => (prev?.action ? null : prev));
  }, []);

  /** undo/redo の窓(Ctrl+Z↔Y で行き来できる時間)を張り直す。切れたら両スナップショットを破棄 */
  const armUndoWindow = useCallback(() => {
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => {
      pendingUndo.current = null;
      pendingRedo.current = null;
    }, UNDO_WINDOW_MS);
  }, []);

  /**
   * 操作の直前に呼ぶ。直前のundoを確定し、今の状態をスナップショットして窓を開く。
   * autoExpire=false のときは窓の自動失効を張らない(日付移動は自前のタイマで管理する)。
   */
  const pushUndo = useCallback(
    (label: string, autoExpire = true) => {
      commitPendingUndo();
      pendingUndo.current = { tasks: tasksRef.current, focusedId: focusedIdRef.current, label };
      if (autoExpire) armUndoWindow();
    },
    [commitPendingUndo, armUndoWindow]
  );

  /** 日付移動(Ctrl+H/K/L)の並び固定だけ畳む(undo/redoスナップショットは保持したいので commit は使わない) */
  const collapseDateShift = useCallback(() => {
    window.clearTimeout(dateShiftTimer.current);
    setDateShift(null);
  }, []);

  // Ctrl+Z: 操作前へ戻す。戻す直前の状態(操作後)は Ctrl+Y 用に控える(Issue #39)
  const performUndo = useCallback(() => {
    if (!ensureWritable()) return;
    const u = pendingUndo.current;
    if (!u) {
      showToast("元に戻せる操作がありません");
      return;
    }
    // 「操作後」の状態をやり直し用に控える(初回のみ。以降のトグルでは上書きしない)
    if (!pendingRedo.current) {
      pendingRedo.current = {
        tasks: tasksRef.current,
        focusedId: focusedIdRef.current,
        label: u.label,
      };
    }
    collapseDateShift();
    setTasks(u.tasks);
    setFocusedId(u.focusedId);
    setAnchorId(u.focusedId);
    armUndoWindow();
    showUndoToast(`元に戻しました: ${u.label}`, "redo");
  }, [showToast, showUndoToast, collapseDateShift, armUndoWindow, ensureWritable]);

  // Ctrl+Y: 直前の Ctrl+Z を取り消して操作後の状態へ戻す(やり直し。Issue #39)
  const performRedo = useCallback(() => {
    if (!ensureWritable()) return;
    const r = pendingRedo.current;
    if (!r) {
      showToast("やり直す操作がありません");
      return;
    }
    collapseDateShift();
    setTasks(r.tasks);
    setFocusedId(r.focusedId);
    setAnchorId(r.focusedId);
    armUndoWindow();
    showUndoToast(`やり直しました: ${r.label}`, "undo");
  }, [showToast, showUndoToast, collapseDateShift, armUndoWindow, ensureWritable]);

  // endDateShift は visibleTasks 依存の armRefocusIfLeaves を使うため、その定義の後に置く(下方)。

  // バックアップ層との接続: 状態の購読・トーストの差し込み・保存先の復元(起動時1回)
  useEffect(() => {
    setBackupNotifier(showToast);
    const unsubscribe = subscribeBackup(setBackupState);
    void restoreBackupDir(tasksRef.current);
    return unsubscribe;
  }, [showToast]);

  // 単一書き手ロック(多重起動の巻き戻り防止。#57)。起動時1回。
  //   昇格(書き手になった)瞬間に、陳腐化した自メモリを捨てて localStorage から読み直す。
  //   引き継ぎ(他窓から譲られた)ときだけ利用者に知らせる(初回取得では黙って編集可にする)。
  useEffect(() => {
    setOnPromote((isHandover) => {
      setTasks(repository.load());
      if (isHandover) showToast("この窓で編集できるようになりました");
    });
    const unsubscribe = subscribeWriter((s) => {
      isPrimaryRef.current = s.isPrimary;
      setIsPrimary(s.isPrimary);
    });
    void startWriterLock();
    return unsubscribe;
  }, [showToast]);

  // 起動直後の一瞬(ロック取得が確定するまで)は読み取り専用に見えるため、
  // すぐにバナーを出すと単独窓で点滅する。少し待って本当に secondary のときだけ出す。
  useEffect(() => {
    const t = window.setTimeout(() => setRoleSettled(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  // ---------- 更新ヘルパー ----------
  // すべてのタスク変更はこの3つ(upsert/remove/removeMany)を通る。読み取り専用の窓では
  // ここで弾くことで、キーボード・ボタン・ダイアログ・インライン編集のどの経路でも変更させない(#57)。
  const upsert = useCallback(
    (updated: Task[]) => {
      if (!ensureWritable()) return;
      setTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        for (const t of updated) map.set(t.id, t);
        return [...map.values()];
      });
    },
    [ensureWritable]
  );

  const remove = useCallback(
    (id: string) => {
      if (!ensureWritable()) return;
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [ensureWritable]
  );

  const removeMany = useCallback(
    (ids: string[]) => {
      if (!ensureWritable()) return;
      const idSet = new Set(ids);
      setTasks((prev) => prev.filter((t) => !idSet.has(t.id)));
    },
    [ensureWritable]
  );

  // インライン編集の保存(1件更新)。トーストを出さない=undo対象にはしないが、
  // 保留中のundoは確定して「あとから消えて驚く」事故を防ぐ(Issue #14)
  const handleUpdateTask = useCallback(
    (t: Task) => {
      commitPendingUndo();
      upsert([t]);
    },
    [upsert, commitPendingUndo]
  );

  // ---------- フィルタ・並び替え ----------
  /** 現在のモード(仕事/個人/すべて)で表示すべきタスクか。タスク自身の scope で判定 */
  const matchesMode = useCallback(
    (t: Task) => mode === "all" || t.scope === mode,
    [mode]
  );

  /**
   * タスク名の判定関数。入力が空なら null(絞り込まない)。
   *   通常          … 中間一致(大文字小文字を区別しない)
   *   /パターン/    … 正規表現。/パターン/i のようにフラグも付けられる
   * 「/」で始まったら正規表現のつもりとみなし、閉じていない・不正なうちは絞り込まない
   * (打ちかけの "/^報" がリテラル検索になって0件になると使いづらいため)
   */
  const titleMatcher = useMemo(() => {
    const q = titleFilter.trim();
    if (!q) return null;
    if (q.startsWith("/")) {
      const re = /^\/(.+)\/([gimsuy]*)$/.exec(q);
      if (!re) return null; // まだ閉じていない
      try {
        const rx = new RegExp(re[1], re[2].replace("g", "")); // g は test() では邪魔
        return (title: string) => rx.test(title);
      } catch {
        return null; // 不正な正規表現
      }
    }
    const lower = q.toLowerCase();
    return (title: string) => title.toLowerCase().includes(lower);
  }, [titleFilter]);

  /** 今の期間ビューに含まれるタスクか(一覧の絞り込みと「重複行へ飛ぶ」で共用) */
  const matchesPeriod = useCallback(
    (t: Task) => {
      const today = todayStr();
      // 繰越 = 前日以前の日付で、まだ終わっていないタスク(忘れ防止で今日系ビューに出す)
      const isCarryover = !!t.date && t.date < today && !t.actEnd;
      switch (viewMode) {
        case "todayOnward":
          // 今日以降(＋毎日)＋繰越
          return !t.date || t.date >= today || isCarryover;
        case "today":
          // 選択日のタスク(日付一致＋毎日)。選択日が今日なら繰越も混ぜる
          return !t.date || t.date === selectedDate || (selectedDate === today && isCarryover);
        case "custom":
          // 指定範囲の日付のみ(繰越は混ぜない)。片側が空ならその側は無制限。
          // 日付なし(毎日のタスク)は特定の期間に属さないので範囲指定では出さない
          return (
            !!t.date && (!customFrom || t.date >= customFrom) && (!customTo || t.date <= customTo)
          );
        case "everything":
          return true;
      }
    },
    [viewMode, selectedDate, customFrom, customTo]
  );

  const visibleTasks = useMemo(() => {
    // 1. 仕事/個人 と 期間
    let list = tasks.filter((t) => matchesMode(t) && matchesPeriod(t));
    // 2. 完了の扱い
    if (doneFilter === "onlyDone") list = list.filter((t) => !!t.actEnd);
    else if (doneFilter === "hideDone") list = list.filter((t) => !t.actEnd);
    // 3. 予定のみ(開始予定時刻が入っているものだけ)
    if (plannedOnly) list = list.filter((t) => !!t.planStart);
    // 4. カテゴリ
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    // 5. タスク名
    if (titleMatcher) list = list.filter((t) => titleMatcher(t.title));
    // 日付移動(Ctrl+H/K/L)で日付を動かしている間は、見た目の並びを「ずらす前の順」に固定する(Issue #14)。
    // 窓が閉じたら dateShift が null に戻り、下の通常の並べ替えに切り替わる。
    if (dateShift) {
      const pos = new Map(dateShift.order.map((id, i) => [id, i] as const));
      // 固定中は、ずらす前に見えていた行を期間フィルタで落とさず残す(Issue #31)。
      // 期間外へ動かしても消えないので、L/H の連打で同じタスクを何日も送れる。
      // (日付移動は他の絞り込み条件(区分・カテゴリ・完了等)を変えないので、
      //  固定前に見えていた=それらは今も満たす。復帰対象は id だけで判定してよい)
      const byId = new Map(tasks.map((t) => [t.id, t] as const));
      const merged = new Map(list.map((t) => [t.id, t] as const));
      for (const id of dateShift.order) {
        const t = byId.get(id);
        if (t) merged.set(id, t);
      }
      return [...merged.values()].sort(
        (a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity)
      );
    }
    return sortTasks(list);
  }, [
    tasks,
    matchesMode,
    matchesPeriod,
    doneFilter,
    plannedOnly,
    categoryFilter,
    titleMatcher,
    dateShift,
  ]);

  /**
   * 指定タスクが今の絞り込みで隠れているなら、見えるようになる最小限だけ緩めてカーソルを合わせる。
   * (重複した予定の行へ案内するときに使う。「重複と言われたがどこにあるか分からない」を防ぐ)
   */
  const revealTask = useCallback(
    (t: Task) => {
      if (mode !== "all" && t.scope !== mode) setMode("all");
      if (!matchesPeriod(t)) setViewMode("everything"); // 期間から外れているなら全期間へ
      if (doneFilter === "hideDone" && t.actEnd) setDoneFilter("all");
      if (doneFilter === "onlyDone" && !t.actEnd) setDoneFilter("all");
      if (plannedOnly && !t.planStart) setPlannedOnly(false);
      if (categoryFilter && t.category !== categoryFilter) setCategoryFilter("");
      if (titleMatcher && !titleMatcher(t.title)) setTitleFilter("");
      setFocusedId(t.id);
      setAnchorId(t.id);
      // 絞り込みを緩めた直後は再描画が要る。行が実際に出てからスクロールする(下の useEffect)
      pendingRevealId.current = t.id;
    },
    [mode, matchesPeriod, doneFilter, plannedOnly, categoryFilter, titleMatcher]
  );

  // revealTask の続き: 対象行が一覧に現れたら画面内へスクロールする
  useEffect(() => {
    const id = pendingRevealId.current;
    if (!id || !visibleTasks.some((t) => t.id === id)) return;
    pendingRevealId.current = null;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }, [visibleTasks]);

  /**
   * カーソル位置のタスクが消えるかもしれない操作の直前に呼ぶ(Issue #36 と同種)。
   * いま見えている並びで隣の行を控えておく。実際に消えたかの判定と移動は下の useEffect が行う。
   */
  const armRefocusIfLeaves = useCallback(
    (leavingId: string) => {
      const idx = visibleTasks.findIndex((t) => t.id === leavingId);
      if (idx < 0) return; // そもそも一覧にいない(=カーソル対象でない)なら何もしない
      const neighbor = visibleTasks[idx + 1] ?? visibleTasks[idx - 1];
      pendingRefocus.current = { leavingId, neighborId: neighbor ? neighbor.id : null };
    },
    [visibleTasks]
  );

  /**
   * 日付移動(Ctrl+H/K/L)の並び固定を終了する(Issue #14)。commitPendingUndo が固定解除＋undo確定を行う。
   * center=true(窓が閉じた)なら、そのタスクを画面へ寄せる。ただし期間外へ動かして
   * 一覧から消える場合は、隣の行へカーソルを送る(Issue #31)。
   * center=false(途中でカーソルが別行へ動いた)なら、整列だけしてカーソルに追従させる。
   */
  const endDateShift = useCallback(
    (center: boolean, taskId?: string) => {
      if (center && taskId) {
        pendingRevealId.current = taskId; // まだ見えていればスクロールで寄せる
        armRefocusIfLeaves(taskId); // 期間外に出て消えたら隣へカーソルを送る(Issue #31)
      }
      commitPendingUndo();
    },
    [commitPendingUndo, armRefocusIfLeaves]
  );

  const categories = useMemo(() => collectCategories(tasks), [tasks]);

  // 集計は現在表示中のタスク(ビュー・モード・絞込を反映)を対象にする
  const totals = useMemo(
    () => ({
      estimate: visibleTasks.filter((t) => !t.actEnd).reduce((s, t) => s + t.estimateMin, 0),
      actual: visibleTasks.reduce((s, t) => s + (actMin(t) ?? 0), 0),
      remain: visibleTasks.reduce((s, t) => s + remainMin(t), 0),
    }),
    [visibleTasks]
  );

  // ---------- タスク操作 ----------
  // 新規タスクの既定 scope = 今のビュー(すべてビューのときは仕事)
  const defaultScope: TaskScope = mode === "personal" ? "personal" : "work";

  const openNewForm = useCallback(
    (initial?: Partial<Task>) => {
      setFormTask(createTask({ date: selectedDate, scope: defaultScope, ...initial }));
      setFormIsNew(true);
    },
    [selectedDate, defaultScope]
  );

  // 複数タスクの一括登録(Issue #9)。日付省略行は選択日、区分は今のビューに合わせる
  const handleBulkAdd = useCallback(
    (rows: ParsedRow[]) => {
      const created = rows.map((r) =>
        createTask({
          title: r.title,
          date: r.date,
          category: r.category,
          estimateMin: r.estimateMin,
          scope: defaultScope,
          // 旧worklist形式(Issue #22)で取り込んだ追加項目。無ければ createTask の既定値のまま
          ...(r.planStart ? { planStart: r.planStart } : {}),
          ...(r.actEnd ? { actEnd: r.actEnd } : {}),
          ...(r.waiting ? { waiting: r.waiting } : {}),
          ...(r.repeat ? { repeat: r.repeat } : {}),
          ...(r.memos && r.memos.length > 0
            ? { memos: [r.memos[0] ?? "", r.memos[1] ?? "", r.memos[2] ?? ""] }
            : {}),
        })
      );
      if (created.length > 0) {
        pushUndo("一括登録");
        upsert(created);
        // 追加した先頭の行へカーソルを移し、行が現れたら画面内へスクロールする
        // (単発の追加と動きを揃える。Issue #36 と同種)
        setFocusedId(created[0].id);
        setAnchorId(created[0].id);
        pendingRevealId.current = created[0].id;
      }
      setBulkAddOpen(false);
      showToast(`${created.length}件を登録しました`, created.length > 0);
    },
    [defaultScope, upsert, showToast, pushUndo]
  );

  // JSONファイルからの一括インポート(Issue #12)。
  // 「差分だけ読み込む」= 無いものは追加し、中身が違うものはファイルの内容で上書きする。
  // 完全に同じものだけスキップ。これにより、消えたデータの復元にそのまま使える。
  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const raw = JSON.parse(await file.text());
        if (!Array.isArray(raw)) {
          showToast("インポート失敗: JSONがタスクの配列ではありません");
          return;
        }
        const byId = new Map(tasks.map((t) => [t.id, t]));
        const write: Task[] = []; // 追加・上書きするタスク(そのまま upsert へ渡す)
        const updatedTitles: string[] = [];
        let added = 0;
        let same = 0;
        let invalid = 0;
        for (const item of raw) {
          if (
            !item ||
            typeof item !== "object" ||
            typeof item.id !== "string" ||
            typeof item.title !== "string"
          ) {
            invalid++;
            continue;
          }
          const t = migrateTask(item);
          const current = byId.get(t.id);
          if (!current) {
            added++;
            write.push(t);
          } else if (JSON.stringify(current) !== JSON.stringify(t)) {
            updatedTitles.push(t.title);
            write.push(t);
          } else {
            same++;
          }
          byId.set(t.id, t); // ファイル内に同じIDが複数あっても二重に数えない
        }
        if (write.length > 0) {
          pushUndo("インポート"); // トーストは出さないがCtrl+Zで戻せる
          upsert(write);
        }
        setImportResult({
          total: raw.length,
          added,
          updatedTitles,
          same,
          invalid,
        });
      } catch {
        showToast("インポート失敗: JSONとして読み込めませんでした");
      }
    },
    [tasks, upsert, showToast, pushUndo]
  );

  const openEditForm = useCallback((task: Task) => {
    setFormTask(task);
    setFormIsNew(false);
  }, []);

  // 開始は時刻入力ダイアログを開き、確定した時刻で開始する(Excel版 StartTask 踏襲)
  const handleStart = useCallback((task: Task) => {
    setStartTarget(task);
  }, []);

  const doStart = useCallback(
    (task: Task, time: string) => {
      pushUndo("開始");
      upsert([startTask(task, time)]);
      setStartTarget(null);
      showToast(`▶ 開始: ${task.title} (${time})`, true);
    },
    [upsert, showToast, pushUndo]
  );

  // 終了も時刻入力ダイアログを開き、確定した時刻で終了する(Excel版 EndTask 踏襲)
  const handleEnd = useCallback((task: Task) => {
    setEndTarget(task);
  }, []);

  const doEnd = useCallback(
    (task: Task, time: string) => {
      pushUndo("終了");
      const { updated, next } = endTask(task, time);
      // 「残りに集中」等で完了行が隠れる場合に、次の残タスクへカーソルを送る(Issue #36 と同種)
      armRefocusIfLeaves(task.id);
      upsert(next ? [updated, next] : [updated]);
      setEndTarget(null);
      showToast(
        next
          ? `■ 完了: ${task.title} (${time}) → 次回 ${next.date} に生成しました`
          : `■ 完了: ${task.title} (${time})`,
        true
      );
    },
    [upsert, showToast, pushUndo, armRefocusIfLeaves]
  );

  const handleInterruptConfirm = useCallback(
    (title: string | undefined, estimate: number) => {
      if (!interruptTarget) return;
      pushUndo("中断");
      const { consumed, remainder, interrupt } = interruptTask(interruptTarget, title, estimate);
      upsert(interrupt ? [consumed, remainder, interrupt] : [consumed, remainder]);
      setInterruptTarget(null);
      showToast(
        interrupt
          ? `⚡ 中断し、割込み「${interrupt.title}」を開始しました`
          : `⚡ 中断しました(残り ${formatMin(remainder.estimateMin) || "0m"})`,
        true
      );
    },
    [interruptTarget, upsert, showToast, pushUndo]
  );

  // タスクを複製(実行状態はリセットした新規タスク)。Issue #1
  const handleCopy = useCallback(
    (task: Task) => {
      pushUndo("コピー");
      const copy = copyTask(task);
      upsert([copy]);
      setFocusedId(copy.id);
      showToast(`コピーしました: ${task.title}`, true);
    },
    [upsert, showToast, pushUndo]
  );

  // タスクを次の日程へ延期(Issue #6 / #37)。
  //   繰り返しなし → 翌営業日 / 繰り返しあり → 次回日程。完了・開始済みは対象外。
  //   対象は「引数のタスク(行ボタン)」優先。無ければ選択タスク、無ければカーソル1件。
  const handlePostpone = useCallback(
    (task?: Task) => {
      const pool = task
        ? [task]
        : selectedIds.length > 0
          ? visibleTasks.filter((t) => selectedIds.includes(t.id))
          : visibleTasks.filter((t) => t.id === focusedId);
      if (pool.length === 0) return;
      // Issue #15: 延期できるのは未開始のみ。完了・開始済みは除いて残りだけ動かす。
      const targets = pool.filter((t) => !t.actEnd && !t.actStart);
      if (targets.length === 0) {
        showToast("延期できるタスクがありません(完了・開始済みは対象外)");
        return;
      }
      const skipped = pool.length - targets.length;
      pushUndo(targets.length > 1 ? `延期(${targets.length}件)` : "延期");
      const moved = targets.map((t) => postponeTask(t));
      // カーソル位置のタスクが一覧から外れる場合に、次の残タスクへカーソルを送る(Issue #36 と同種)
      armRefocusIfLeaves(focusedId ?? targets[0].id);
      upsert(moved);
      showToast(
        targets.length > 1
          ? `${targets.length}件を延期しました${skipped ? `(${skipped}件は対象外)` : ""}`
          : `延期しました: ${formatDateJa(moved[0].date as string)}`,
        true
      );
    },
    [visibleTasks, selectedIds, focusedId, upsert, showToast, pushUndo, armRefocusIfLeaves]
  );

  /**
   * 待ちトグル(Excel版 WaitTask 踏襲):
   *   未完了タスク → 待ちフラグのON/OFF
   *   完了タスク   → 待ちタスクとして複製(見積0・実績クリア)
   */
  const handleToggleWait = useCallback(
    (task: Task) => {
      if (task.actEnd) {
        pushUndo("待ちタスク複製");
        const copy = createWaitCopy(task);
        upsert([copy]);
        setFocusedId(copy.id);
        showToast(`待ちタスクとして複製: ${task.title}`, true);
      } else {
        pushUndo("待ち切替");
        const updated = toggleWaiting(task);
        upsert([updated]);
        showToast(updated.waiting ? `待ちON: ${task.title}` : `待ちOFF: ${task.title}`, true);
      }
    },
    [upsert, showToast, pushUndo]
  );

  // クリップボード取込(Excel版 UnifiedInsertTask 踏襲)
  const handleClipboardImport = useCallback(async () => {
    try {
      // リッチテキスト(text/html)も読む。Teamsリンクの「表示テキスト」はここにしか無く、
      // プレーンテキストだけだとタスク名が拾えない(Excel版 InsertTeamsLink 踏襲)
      const { text, html } = await readClipboard();
      if (!text.trim() && !html) {
        showToast("クリップボードが空です");
        return;
      }
      const { kind, task } = parseClipboardText(text, html);

      // Outlook予定は同じものを二度貼りがちなので、既に登録済みなら追加せず既存行へ案内する。
      // 日付・タスク名(会議室/来客の表記込み)・開始予定・見積がすべて一致したら重複とみなす
      if (kind === "calendar") {
        const dup = tasks.find(
          (t) =>
            t.date === task.date &&
            t.title === task.title &&
            (t.planStart ?? "") === (task.planStart ?? "") &&
            t.estimateMin === task.estimateMin
        );
        if (dup) {
          revealTask(dup);
          showToast(`重複: 「${dup.title}」は既に登録されています`);
          return;
        }
      }

      const kindLabel = { teams: "Teamsリンク", calendar: "予定", plain: "テキスト" }[kind];
      showToast(`${kindLabel}として認識しました。内容を確認して保存してください`);
      // 取込タスクも今のビューの仕事/個人に合わせる
      setFormTask({ ...task, scope: defaultScope });
      setFormIsNew(true);
    } catch {
      showToast("クリップボードを読み取れませんでした(ブラウザの許可が必要です)");
    }
  }, [showToast, defaultScope, tasks, revealTask]);

  /**
   * 一覧に出ているタスクをCSVにしてクリップボードへ。生成AIに渡して日記にする用途。
   * 対象は「今表示しているもの」なので、絞り込み(期間・完了のみ 等)がそのまま効く。
   */
  const handleCopyCsv = useCallback(async () => {
    if (visibleTasks.length === 0) {
      showToast("コピーするタスクがありません(絞り込みを確認してください)");
      return;
    }
    try {
      await navigator.clipboard.writeText(tasksToCsv(visibleTasks));
      showToast(`CSVをコピーしました(${visibleTasks.length}件)`);
    } catch {
      showToast("クリップボードにコピーできませんでした");
    }
  }, [visibleTasks, showToast]);

  /**
   * ローカルパス(フォルダ/ファイル)をクリップボードへコピーする(#45)。
   * ブラウザは https 由来の file:// を開けないため、コピー→エクスプローラのアドレス欄へ
   * 貼り付けてもらう運用にする(安全側)。
   */
  const handleCopyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        showToast("パスをコピーしました。エクスプローラのアドレス欄に貼り付けてください");
      } catch {
        showToast("クリップボードにコピーできませんでした");
      }
    },
    [showToast]
  );

  /**
   * 選択したタスクをGoogleカレンダーへ登録/更新する(手動upsert・deleteはしない)。
   * 認証はこのボタン押下(ユーザー操作)を起点にする。成功分の gcalEventId を保存し、
   * 結果はダイアログで件数報告する。予定でないもの(時刻なし)は黙ってスキップ。
   */
  const handleSyncCalendar = useCallback(async () => {
    // 連打・二重起動をここで弾く(ボタンのdisabledより前の最終防衛線。Issue #29)。
    // state更新は非同期なので、同期的に判定できる ref を真偽の基準にする。
    if (syncingCalendarRef.current) return;
    // 読み取り専用の窓では gcalEventId の書き戻し(setTasks)が発生するため弾く(#57)
    if (!ensureWritable()) return;

    const { clientId, calendarId } = loadGcalConfig();
    if (!clientId || !calendarId) {
      showToast("Client ID / Calendar ID を 💾 メニューで設定してください");
      return;
    }
    const targets = selectedIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is Task => !!t);
    if (targets.length === 0) return;

    syncingCalendarRef.current = true;
    setSyncingCalendar(true);
    try {
      // 初回のみ同意画面。以降はセッションがあれば画面なしで取得(ポップアップブロック回避のため
      // ボタン押下の同期的な流れの中で呼ぶ)
      try {
        await acquireToken(clientId);
      } catch (e) {
        showToast(`カレンダー連携を中止しました: ${e instanceof Error ? e.message : ""}`);
        return;
      }

      const client = createGoogleCalendarClient(clientId, calendarId);
      const idUpdates: { id: string; eventId: string }[] = [];
      const summary = await syncTasksToCalendar(targets, client, (taskId, eventId) =>
        idUpdates.push({ id: taskId, eventId })
      );
      // 成功分だけ gcalEventId を書き戻す(失敗した件は未同期のまま=押し直しでリトライ)。
      // これは裏方の書き込み。保留中のundoは確定だけして、これ自体はundo対象にしない
      commitPendingUndo();
      if (idUpdates.length > 0) {
        setTasks((prev) =>
          prev.map((t) => {
            const u = idUpdates.find((x) => x.id === t.id);
            return u ? { ...t, gcalEventId: u.eventId } : t;
          })
        );
      }
      setCalSyncResult(summary);
    } finally {
      syncingCalendarRef.current = false;
      setSyncingCalendar(false);
    }
  }, [selectedIds, tasks, showToast, commitPendingUndo, ensureWritable]);

  const handleResetCalendarAuth = useCallback(() => {
    resetGcalAuth();
    showToast("カレンダー連携をリセットしました(トークンを破棄)");
  }, [showToast]);

  // ランダム開始(Excel版 StartRandomTodayTask 踏襲)。待ちタスク・モード対象外は除く
  const handleRandomStart = useCallback(() => {
    const candidates = tasks.filter(
      (t) =>
        (!t.date || t.date === selectedDate) &&
        !t.planStart &&
        derivedStatus(t) === "notStarted" &&
        matchesMode(t)
    );
    if (candidates.length === 0) {
      showToast("該当するタスクが見つかりませんでした");
      return;
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    handleStart(picked);
  }, [tasks, selectedDate, handleStart, showToast, matchesMode]);

  // モードを 仕事→個人→すべて の順に巡回(Mキー)
  const cycleMode = useCallback(() => {
    setMode((m) => {
      const next: WorkMode = m === "work" ? "personal" : m === "personal" ? "all" : "work";
      showToast(`モード: ${WORK_MODE_LABELS[next]}`);
      return next;
    });
  }, [showToast]);

  // 連続開始時刻セット(Excel版 SetSequentialStartHHMM 踏襲)
  //   選択した順に、見積を積み上げて開始予定時刻を割り当てる。
  //   まず時刻入力ダイアログ(4桁)を開き、確定後に処理する。
  const handleSequentialStart = useCallback(() => {
    if (selectedIds.length === 0) return;
    setSeqOpen(true);
  }, [selectedIds]);

  const doSequentialStart = useCallback(
    (firstStart: string) => {
      // 選択順(selectedIds の並び)にタスクを並べる
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const targets = selectedIds
        .map((id) => byId.get(id))
        .filter((t): t is Task => !!t);
      if (targets.length > 0) {
        pushUndo("連続時刻");
        upsert(setSequentialStart(targets, firstStart));
      }
      setSeqOpen(false);
      setSelectedIds([]);
      showToast(`${targets.length}件に選択した順で開始予定時刻を設定しました`, targets.length > 0);
    },
    [tasks, selectedIds, upsert, showToast, pushUndo]
  );

  // ビュー切替。「今日」を選んだら選択日を今日に戻す
  const changeView = useCallback(
    (v: ViewMode) => {
      setViewMode(v);
      if (v === "today") setSelectedDate(todayStr());
      // カスタムを初めて開いたときは今日を起点にしておく(空のままだと全件出て驚くため)
      if (v === "custom" && !customFrom && !customTo) setCustomFrom(todayStr());
    },
    [customFrom, customTo]
  );

  const toggleSelect = useCallback((id: string) => {
    setFocusedId(id); // 行カーソルも触った行へ(マウス⇄キーボード混在時のズレ防止。Issue #26)
    setAnchorId(id); // 範囲選択の基準
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const selectAllVisible = useCallback(
    () => setSelectedIds(visibleTasks.map((t) => t.id)),
    [visibleTasks]
  );

  // 一括編集(Issue #3): 選択タスクへ、チェックした項目だけ適用する
  const applyBulk = useCallback(
    (changes: BulkChanges) => {
      const today = todayStr();
      const sel = new Set(selectedIds);
      const updated = tasks
        .filter((t) => sel.has(t.id))
        .map((t) => {
          const patch: Partial<Task> = {};
          if (changes.date) {
            if (changes.date.kind === "set") {
              patch.date = changes.date.value;
            } else if (changes.date.by === "today") {
              patch.date = today;
            } else {
              patch.date = addToDate(t.date ?? today, "day", changes.date.by);
            }
          }
          if (changes.deadline) patch.deadline = changes.deadline.value;
          if (changes.category !== undefined) patch.category = changes.category;
          if (changes.importance !== undefined) patch.importance = changes.importance;
          if (changes.scope !== undefined) patch.scope = changes.scope;
          return { ...t, ...patch, updatedAt: new Date().toISOString() };
        });
      if (updated.length > 0) {
        pushUndo("一括編集");
        upsert(updated);
      }
      setBulkOpen(false);
      setSelectedIds([]);
      showToast(`${updated.length}件を一括更新しました`, updated.length > 0);
    },
    [tasks, selectedIds, upsert, showToast, pushUndo]
  );

  // ---------- カーソル移動(↑↓キー) ----------
  const moveFocus = useCallback(
    (delta: number) => {
      if (visibleTasks.length === 0) return;
      const idx = visibleTasks.findIndex((t) => t.id === focusedId);
      const next =
        idx === -1
          ? delta > 0
            ? 0
            : visibleTasks.length - 1
          : Math.min(Math.max(idx + delta, 0), visibleTasks.length - 1);
      const id = visibleTasks[next].id;
      setFocusedId(id);
      setAnchorId(id); // 次の範囲選択(Shift+↑↓)の基準にする
      // カーソル行(あれば列セル)が画面外なら追従スクロール
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
        const cell = focusedField
          ? row?.querySelector(`[data-field="${focusedField}"]`)
          : null;
        (cell ?? row)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [visibleTasks, focusedId, focusedField]
  );

  /** id の行へカーソルを移し、選択範囲の基準も更新して画面内へスクロール(moveFocus等と共通の後始末) */
  const focusRow = useCallback(
    (id: string) => {
      setFocusedId(id);
      setAnchorId(id);
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
        const cell = focusedField ? row?.querySelector(`[data-field="${focusedField}"]`) : null;
        (cell ?? row)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [focusedField]
  );

  /** 単体削除(確認 + Undo + カーソル維持)。行の🗑ボタン・Deleteキーで共通利用(#43)。 */
  const handleDeleteTask = useCallback(
    (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!confirm(`「${target?.title ?? ""}」を削除しますか？`)) return;
      // 削除した行の位置に次の行を繰り上げてカーソルを残す(無ければ1つ上へ)
      const idx = visibleTasks.findIndex((t) => t.id === id);
      const nextFocus = visibleTasks[idx + 1] ?? visibleTasks[idx - 1];
      pushUndo("削除");
      remove(id);
      setFocusedId(nextFocus ? nextFocus.id : null);
      showToast("削除しました", true);
    },
    [tasks, visibleTasks, pushUndo, remove, showToast]
  );

  /** 選択中をまとめて削除(確認 + Undo + カーソル維持)。一括削除ボタン・Deleteキーで共通利用(#43)。 */
  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    if (!confirm(`選択した${selectedIds.length}件を削除しますか？`)) return;
    // 選択より後ろの最初の残存行、無ければ前の残存行へカーソルを移す
    const selSet = new Set(selectedIds);
    let lastSelIdx = -1;
    visibleTasks.forEach((t, i) => {
      if (selSet.has(t.id)) lastSelIdx = i;
    });
    let nextFocus: Task | undefined;
    for (let i = lastSelIdx + 1; i < visibleTasks.length; i++) {
      if (!selSet.has(visibleTasks[i].id)) {
        nextFocus = visibleTasks[i];
        break;
      }
    }
    if (!nextFocus) {
      for (let i = lastSelIdx - 1; i >= 0; i--) {
        if (!selSet.has(visibleTasks[i].id)) {
          nextFocus = visibleTasks[i];
          break;
        }
      }
    }
    pushUndo(`削除(${selectedIds.length}件)`);
    removeMany(selectedIds);
    setSelectedIds([]);
    setAnchorId(null);
    setFocusedId(nextFocus ? nextFocus.id : null);
    showToast(`${selectedIds.length}件を削除しました`, true);
  }, [selectedIds, visibleTasks, pushUndo, removeMany, showToast]);

  // armRefocusIfLeaves の続き: 対象が一覧から消えていたら、控えておいた隣へカーソルを送る(Issue #36 と同種)。
  useEffect(() => {
    const p = pendingRefocus.current;
    if (!p) return;
    // 対象がまだ見えている(全て表示・期間内など)ならカーソルはそのままでよい
    if (visibleTasks.some((t) => t.id === p.leavingId)) {
      pendingRefocus.current = null;
      return;
    }
    pendingRefocus.current = null;
    // 消えたのがカーソル位置の行だったときだけ動かす(別行への操作でカーソルを奪わない)
    if (focusedId !== p.leavingId) return;
    if (p.neighborId) focusRow(p.neighborId);
    else setFocusedId(null);
  }, [visibleTasks, focusedId, focusRow]);

  // ---------- カテゴリの区切りへジャンプ(Ctrl+↑↓) ----------
  // 同じカテゴリの行が連続しているとき、次/前の「違うカテゴリの先頭行」へ一気に移動する。
  const jumpCategoryGroup = useCallback(
    (delta: number) => {
      if (visibleTasks.length === 0) return;
      const idx = visibleTasks.findIndex((t) => t.id === focusedId);
      if (idx === -1) {
        focusRow(visibleTasks[delta > 0 ? 0 : visibleTasks.length - 1].id);
        return;
      }
      const curCategory = visibleTasks[idx].category;
      if (delta > 0) {
        let i = idx + 1;
        while (i < visibleTasks.length && visibleTasks[i].category === curCategory) i++;
        focusRow(visibleTasks[Math.min(i, visibleTasks.length - 1)].id);
      } else {
        let i = idx - 1;
        while (i >= 0 && visibleTasks[i].category === curCategory) i--;
        if (i < 0) {
          focusRow(visibleTasks[0].id);
          return;
        }
        // 直前のグループの「先頭」まで戻る
        const prevCategory = visibleTasks[i].category;
        while (i - 1 >= 0 && visibleTasks[i - 1].category === prevCategory) i--;
        focusRow(visibleTasks[i].id);
      }
    },
    [visibleTasks, focusedId, focusRow]
  );

  // ---------- Homeキー: 「今どこをやっているか」へジャンプ ----------
  // 実行中のタスクがあればそこへ。無ければ最後に完了したタスクの次(=次にやること)。
  // 完了したタスクも無ければ先頭行。
  const jumpToCurrent = useCallback(() => {
    if (visibleTasks.length === 0) return;

    let target = visibleTasks[0];
    const running = visibleTasks.find((t) => derivedStatus(t) === "running");
    if (running) {
      target = running;
    } else {
      let lastDoneIdx = -1;
      visibleTasks.forEach((t, i) => {
        if (derivedStatus(t) === "done") lastDoneIdx = i;
      });
      if (lastDoneIdx !== -1)
        target = visibleTasks[Math.min(lastDoneIdx + 1, visibleTasks.length - 1)];
    }

    setFocusedId(target.id);
    setAnchorId(target.id);
    // カーソル行までスクロールはしない。一覧は先頭から見せる。
    // (夕方に押すと、その日にやったタスクが全部上へ隠れてしまうため)
    // スクロール枠は再描画を待たずに掴めるので、ここで即座に戻す
    document.querySelector("[data-task-scroll]")?.scrollTo({ top: 0 });
  }, [visibleTasks]);

  // ---------- カーソル列移動(←→キー。Excel風セル移動)Issue #5 ----------
  const onFocusCell = useCallback((id: string, field: EditableField) => {
    setFocusedId(id);
    setAnchorId(id); // 範囲選択の基準もカーソルに合わせる(マウス⇄キーボード混在時のズレ防止。Issue #26)
    setFocusedField(field);
  }, []);

  const moveColumn = useCallback(
    (delta: number) => {
      if (visibleTasks.length === 0) return;
      // 行が未選択なら先頭行を選ぶ
      const id = focusedId ?? visibleTasks[0].id;
      if (focusedId == null) setFocusedId(id);
      setFocusedField((prev) => {
        const idx = prev == null ? (delta > 0 ? -1 : EDIT_ORDER.length) : EDIT_ORDER.indexOf(prev);
        const nextIdx = Math.min(Math.max(idx + delta, 0), EDIT_ORDER.length - 1);
        const field = EDIT_ORDER[nextIdx];
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-task-id="${CSS.escape(id)}"] [data-field="${field}"]`)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        return field;
      });
    },
    [visibleTasks, focusedId]
  );

  // ---------- 日付移動(Ctrl+H/K/L。Issue #7 / #54 / Excel NextDay・PreviousDay 相当)----------
  // 複数選択があれば選択タスクをまとめて移動する(Issue #23)。無ければカーソルの1件。
  // 日付移動(Ctrl+H=前日 / Ctrl+L=翌日 / Ctrl+K=今日。Issue #54)。
  // 相対移動(prev/next)と絶対移動(today)を1本にまとめる。挙動(複数選択のまとめ移動・
  // undo・並び固定の窓・カーソル追従)は3操作で共通。
  const moveFocusedDate = useCallback(
    (mode: "prev" | "next" | "today") => {
      const pool =
        selectedIds.length > 0
          ? visibleTasks.filter((t) => selectedIds.includes(t.id))
          : visibleTasks.filter((t) => t.id === focusedId);
      if (pool.length === 0) return;
      const today = todayStr();
      // 「今日へ」は既に今日のタスクを除外(動かす必要がないので何もしない)
      const targets = mode === "today" ? pool.filter((t) => (t.date ?? today) !== today) : pool;
      if (targets.length === 0) {
        showToast("すでに今日です");
        return;
      }
      const bulk = targets.length > 1;
      const key = bulk ? "bulk" : targets[0].id;
      // 同じ対象を続けて動かしているときは、まとめて1つのundo・並びも固定のまま(連打対応)。
      // 新規セッションのときだけスナップショットと「ずらす前の並び」を確保する。
      const fresh = !dateShift || dateShift.key !== key;
      if (fresh) {
        pushUndo("日付移動", false); // 失効は下の dateShiftTimer が管理する
        setDateShift({ key, order: visibleTasks.map((t) => t.id), focusId: focusedId });
      }
      const now = new Date().toISOString();
      const moved = targets.map((t) => ({
        ...t,
        date:
          mode === "today"
            ? today
            : addToDate(t.date ?? today, "day", mode === "next" ? 1 : -1),
        updatedAt: now,
      }));
      upsert(moved);
      const dest = mode === "today" ? "今日" : mode === "next" ? "翌日" : "前日";
      showToast(
        bulk
          ? `${moved.length}件を${dest}へ`
          : `${moved[0].title || "(無題)"} → ${formatDateJa(moved[0].date as string)}`,
        true
      );
      // 窓(=固定)の終了タイマ。押すたびに延長し、止まったら整列＋中央寄せ(カーソル位置へ)
      window.clearTimeout(dateShiftTimer.current);
      dateShiftTimer.current = window.setTimeout(
        () => endDateShift(true, focusedId ?? undefined),
        UNDO_WINDOW_MS
      );
    },
    [dateShift, visibleTasks, focusedId, selectedIds, upsert, showToast, pushUndo, endDateShift]
  );

  // 日付移動(Ctrl+H/K/L)の固定中にカーソルが別タスクへ動いたら、整列してカーソルに追従する(中央寄せはしない)
  useEffect(() => {
    if (dateShift && focusedId !== dateShift.focusId) endDateShift(false);
  }, [focusedId, dateShift, endDateShift]);

  // ---------- 範囲選択(Shift+クリック / Shift+↑↓。Issue #8)----------
  /** 基準(anchor)から id までの表示順の連続範囲を選択 */
  const rangeSelectTo = useCallback(
    (id: string) => {
      const anchor = anchorId ?? id;
      const ai = visibleTasks.findIndex((t) => t.id === anchor);
      const bi = visibleTasks.findIndex((t) => t.id === id);
      if (ai === -1 || bi === -1) return;
      const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
      setSelectedIds(visibleTasks.slice(lo, hi + 1).map((t) => t.id));
      setFocusedId(id); // カーソルはShift+クリックした行(範囲の端)へ。anchorは基準のまま。Issue #26
    },
    [anchorId, visibleTasks]
  );

  /** Shift+↑↓: カーソルを動かしつつ基準からの範囲を選択 */
  const extendSelection = useCallback(
    (delta: number) => {
      if (visibleTasks.length === 0) return;
      const curIdx = visibleTasks.findIndex((t) => t.id === focusedId);
      const from = curIdx === -1 ? 0 : curIdx;
      const to = Math.min(Math.max(from + delta, 0), visibleTasks.length - 1);
      const newId = visibleTasks[to].id;
      setFocusedId(newId);
      const anchor = anchorId ?? focusedId ?? newId;
      const ai = visibleTasks.findIndex((t) => t.id === anchor);
      if (ai !== -1) {
        const [lo, hi] = ai <= to ? [ai, to] : [to, ai];
        setSelectedIds(visibleTasks.slice(lo, hi + 1).map((t) => t.id));
      }
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-task-id="${CSS.escape(newId)}"]`)
          ?.scrollIntoView({ block: "nearest" })
      );
    },
    [visibleTasks, focusedId, anchorId]
  );

  // ---------- ショートカットキー ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 入力中・ダイアログ表示中は無効
      const tag = (e.target as HTMLElement)?.tagName;
      // Esc: 絞り込み検索などの入力欄にフォーカスがあるとショートカットが効かない。
      // Esc を押したら入力欄を抜けて一覧へ戻す(Issue #27)。
      //  - モーダルは各自 Esc を持つので触らない
      //  - セル編集の Esc は EditableCell が preventDefault 済み(defaultPrevented)なので巻き込まない
      if (e.key === "Escape" && !e.defaultPrevented) {
        const anyModal =
          formTask ||
          interruptTarget ||
          startTarget ||
          endTarget ||
          seqOpen ||
          bulkOpen ||
          bulkAddOpen ||
          importResult ||
          calSyncResult ||
          helpOpen;
        if (!anyModal && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) {
          e.preventDefault();
          (e.target as HTMLElement)?.blur();
          // 行カーソルが未設定なら先頭へ(戻った直後からキーボード操作できるように)
          if (focusedId == null && visibleTasks.length > 0) setFocusedId(visibleTasks[0].id);
          return;
        }
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // ボタン上のEnter/Spaceはボタン自体の動作を優先(二重発火防止)
      if ((tag === "BUTTON" || tag === "A") && (e.key === "Enter" || e.key === " ")) return;
      if (
        formTask ||
        interruptTarget ||
        startTarget ||
        endTarget ||
        seqOpen ||
        bulkOpen ||
        bulkAddOpen ||
        importResult ||
        calSyncResult ||
        helpOpen // 閉じる操作はヘルプ側が持つ(Esc / ? / クリック)
      )
        return;

      // ?: ショートカット一覧(Shift+/ なので修飾キーの判定より前に見る)
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // 日付移動は Ctrl 系に集約(Issue #54): Ctrl+H=前日 / Ctrl+K=今日 / Ctrl+L=翌日。
      // ブラウザ既定(履歴/検索/アドレスバー)より優先するため preventDefault。
      // ただし対象タスクが無いときは既定に委ねる。(focused は後段で算出するのでここでは自前判定)
      if (e.ctrlKey || e.metaKey) {
        const ck = e.key.toLowerCase();
        if (ck === "h" || ck === "k" || ck === "l") {
          const hasTarget =
            selectedIds.length > 0 || visibleTasks.some((t) => t.id === focusedId);
          if (!hasTarget) return;
          e.preventDefault();
          moveFocusedDate(ck === "h" ? "prev" : ck === "l" ? "next" : "today");
          return;
        }
      }
      // Ctrl/⌘+Z: 直前の操作を元に戻す(単段・自動確定。Issue #14)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        performUndo();
        return;
      }
      // Ctrl/⌘+Y(または Ctrl/⌘+Shift+Z): 直前の Ctrl+Z を取り消してやり直す(Issue #39)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        performRedo();
        return;
      }
      // Ctrl/⌘+Enter: カーソル位置のタスクの詳細編集を開く(列選択中でもセル編集を挟まず一発で)
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        const target = visibleTasks.find((t) => t.id === focusedId);
        if (target) openEditForm(target);
        return;
      }
      // Ctrl/⌘+↑↓: 同じカテゴリの並びを飛び越えて次/前のカテゴリの先頭へ
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowDown") {
        e.preventDefault();
        jumpCategoryGroup(1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowUp") {
        e.preventDefault();
        jumpCategoryGroup(-1);
        return;
      }
      // Ctrl+PageUp/PageDown はブラウザのタブ切替と競合するため使わない(修飾なしの5行移動のみ)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // カーソル位置のタスク(Excel版のアクティブセル行に相当)
      const focused = visibleTasks.find((t) => t.id === focusedId);
      const running = focused && !!focused.actStart && !focused.actEnd;

      switch (e.key.toLowerCase()) {
        case "escape": // 複数選択を全解除(Issue #24)
          if (selectedIds.length > 0) {
            e.preventDefault();
            clearSelection();
            setAnchorId(null);
          }
          break;
        case "n":
          e.preventDefault();
          openNewForm();
          break;
        case "v":
          e.preventDefault();
          handleClipboardImport();
          break;
        // 表示形式は「表ライト」のみにしたので巡回するものが無い。
        // 表形式/カード形式を戻すときは、ここと Toolbar の切替チップを復活させる
        // case "t": // 表 → 表ライト → カード の巡回
        //   e.preventDefault();
        //   setLayout((l) =>
        //     l === "table" ? "tableLight" : l === "tableLight" ? "cards" : "table"
        //   );
        //   break;
        case "m": // 仕事/個人/すべて モード巡回
          e.preventDefault();
          cycleMode();
          break;
        case "arrowup":
          e.preventDefault();
          if (e.shiftKey) extendSelection(-1); // Shift+↑: 範囲選択(Issue #8)
          else moveFocus(-1);
          break;
        case "arrowdown":
          e.preventDefault();
          if (e.shiftKey) extendSelection(1); // Shift+↓: 範囲選択
          else moveFocus(1);
          break;
        case "j": // 下の行へ(vim準拠。移動後はそのまま Ctrl+Enter で詳細を開ける。Issue #21)
          e.preventDefault();
          if (e.shiftKey) extendSelection(1);
          else moveFocus(1);
          break;
        case "k": // 上の行へ(vim準拠)
          e.preventDefault();
          if (e.shiftKey) extendSelection(-1);
          else moveFocus(-1);
          break;
        case "arrowleft": // 表: 左の列へ(Excel風セル移動)Issue #5
        case "h": // 表: 左の列へ(vim準拠。j/k=行 と合わせて h/j/k/l でセル移動)
          if (layout === "cards") break;
          e.preventDefault();
          moveColumn(-1);
          break;
        case "arrowright": // 表: 右の列へ
        case "l": // 表: 右の列へ(vim準拠)
          if (layout === "cards") break;
          e.preventDefault();
          moveColumn(1);
          break;
        case "home": // 「今どこをやっているか」へジャンプ: 実行中→無ければ完了の次→無ければ先頭
          e.preventDefault();
          jumpToCurrent();
          break;
        case "pagedown": // 5行下へ
          e.preventDefault();
          moveFocus(5);
          break;
        case "pageup": // 5行上へ
          e.preventDefault();
          moveFocus(-5);
          break;
        case "s": // 開始/再開(Excel版 StartTask)
          if (!focused) break;
          e.preventDefault();
          if (running) showToast("既に実行中です(E=終了 / I=中断)");
          else if (focused.actEnd) showToast("完了済みのタスクです(W=待ちタスクとして複製)");
          else handleStart(focused);
          break;
        case "w": // 待ちトグル/待ちタスク複製(Excel版 WaitTask)
          if (!focused) break;
          e.preventDefault();
          handleToggleWait(focused);
          break;
        case "e": // 終了(Excel版 EndTask)
          if (!focused) break;
          e.preventDefault();
          if (running) handleEnd(focused);
          else showToast("開始していないタスクです(S=開始)");
          break;
        case "i": // 中断・割り込み(Excel版 InterruputTask)
          if (!focused) break;
          e.preventDefault();
          if (running) setInterruptTarget(focused);
          else showToast("実行中のタスクのみ中断できます");
          break;
        case "c": // コピー(複製)
          if (!focused) break;
          e.preventDefault();
          handleCopy(focused);
          break;
        case "p": // 次の日程へ延期(選択があればまとめて/無ければカーソル。判定は handlePostpone)
          if (!focused && selectedIds.length === 0) break;
          e.preventDefault();
          handlePostpone();
          break;
        case "enter": // 表: カーソルのセルを編集。列未選択や表以外は詳細編集
          if (!focused) break;
          e.preventDefault();
          if (layout !== "cards" && focusedField) {
            setEditingCell({ id: focused.id, field: focusedField });
          } else {
            openEditForm(focused);
          }
          break;
        case " ": // 連続時刻設定などの選択トグル
          if (!focused) break;
          e.preventDefault();
          toggleSelect(focused.id);
          break;
        case "delete":
          e.preventDefault();
          // 複数選択があればまとめて削除。無ければカーソル行を単体削除(共通ロジック #43)
          if (selectedIds.length > 0) handleDeleteSelected();
          else if (focused) handleDeleteTask(focused.id);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    formTask,
    interruptTarget,
    startTarget,
    endTarget,
    seqOpen,
    bulkOpen,
    bulkAddOpen,
    importResult,
    calSyncResult,
    helpOpen,
    openNewForm,
    handleClipboardImport,
    visibleTasks,
    focusedId,
    focusedField,
    layout,
    moveFocus,
    moveColumn,
    extendSelection,
    moveFocusedDate,
    jumpCategoryGroup,
    jumpToCurrent,
    selectedIds,
    handleStart,
    handleEnd,
    handleToggleWait,
    handleCopy,
    handlePostpone,
    openEditForm,
    toggleSelect,
    handleDeleteTask,
    handleDeleteSelected,
    showToast,
    cycleMode,
    pushUndo,
    performUndo,
    performRedo,
  ]);

  // ---------- 描画 ----------
  const actionHandlers = {
    onStart: handleStart,
    onEnd: handleEnd,
    onInterrupt: setInterruptTarget,
    onCopy: handleCopy,
    onPostpone: handlePostpone,
    onEdit: openEditForm,
    onDelete: (t: Task) => handleDeleteTask(t.id),
  };

  return (
    // 画面の高さに固定し、ページ自体はスクロールさせない(表のコンテナだけがスクロールする)。
    // こうしないとページが少し溢れてウィンドウがスクロールし、固定ヘッダがツールバーの裏に隠れる
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <Toolbar
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          showToast(`モード: ${WORK_MODE_LABELS[m]}`);
        }}
        viewMode={viewMode}
        onViewModeChange={changeView}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        doneFilter={doneFilter}
        onDoneFilterChange={setDoneFilter}
        plannedOnly={plannedOnly}
        onPlannedOnlyChange={setPlannedOnly}
        titleFilter={titleFilter}
        onTitleFilterChange={setTitleFilter}
        onAdd={() => openNewForm()}
        onClipboardImport={handleClipboardImport}
        onBulkAdd={() => setBulkAddOpen(true)}
        onRandomStart={handleRandomStart}
        onSequentialStart={handleSequentialStart}
        onBulkEdit={() => selectedIds.length > 0 && setBulkOpen(true)}
        onSyncCalendar={handleSyncCalendar}
        syncingCalendar={syncingCalendar}
        onResetCalendarAuth={handleResetCalendarAuth}
        onSelectAllVisible={selectAllVisible}
        onClearSelection={clearSelection}
        onDeleteSelected={handleDeleteSelected}
        selectedCount={selectedIds.length}
        onExport={() => exportTasksAsJson(tasks)}
        onCopyCsv={handleCopyCsv}
        visibleCount={visibleTasks.length}
        onImportFile={handleImportFile}
        backup={backupState}
        onChooseBackupDir={() => void chooseBackupDir(tasks)}
        onReconnectBackupDir={() => void reconnectBackupDir(tasks)}
        onDisconnectBackupDir={() => void disconnectBackupDir()}
        onBackupNow={() => void backupNow(tasks)}
        onSnoozeBackup={snoozeBackupWarning}
        onClearBackupSnooze={clearBackupSnooze}
        totals={totals}
        onOpenHelp={() => setHelpOpen(true)}
        readOnly={!isPrimary}
      />

      {/* 読み取り専用バナー(#57): 別窓で編集中のとき。ここで編集すると他窓の変更を
          消す事故になるため書き込みを止めている旨を示し、明示操作で書き手を引き継げる */}
      {!isPrimary && roleSettled && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-1.5 text-sm text-amber-900">
          <span>
            👁 この窓は読み取り専用です(別のウィンドウで編集中)。巻き戻り事故を防ぐため書き込みを止めています。
          </span>
          <button
            type="button"
            onClick={() => requestTakeover()}
            className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
          >
            この窓で編集
          </button>
        </div>
      )}

      {/* 表示形式は「表ライト」のみ。カード形式(TaskCards)は一覧から外した(types.ts 参照)。
          戻すときは max-w の出し分けと TaskCards の分岐をここに復活させる */}
      <main className="mx-auto flex w-full min-h-0 max-w-none flex-1 flex-col p-4">
        <TaskTable
          tasks={visibleTasks}
          dense={layout === "tableLight"}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onRangeSelectTo={rangeSelectTo}
          onToggleWait={handleToggleWait}
          onUpdateTask={handleUpdateTask}
          focusedId={focusedId}
          focusedField={focusedField}
          onFocusCell={onFocusCell}
          onFocusTask={focusRow}
          onCopyPath={handleCopyPath}
          editing={editingCell}
          onEditingChange={setEditingCell}
          readOnly={!isPrimary}
          {...actionHandlers}
        />
        {/* <TaskCards
          tasks={visibleTasks}
          selectedIds={selectedIds}
          onToggleWait={handleToggleWait}
          focusedId={focusedId}
          onFocusTask={setFocusedId}
          {...actionHandlers}
        /> */}

      </main>

      {/* ダイアログ類 */}
      {helpOpen && <ShortcutHelpDialog onClose={() => setHelpOpen(false)} />}
      {calSyncResult && (
        <CalendarSyncResultDialog result={calSyncResult} onClose={() => setCalSyncResult(null)} />
      )}

      {formTask && (
        <TaskForm
          task={formTask}
          isNew={formIsNew}
          categories={categories}
          suggestCategory={(title) => suggestCategoryByTitle(tasks, title)}
          onSave={(t) => {
            pushUndo(formIsNew ? "追加" : "更新");
            upsert([t]);
            setFormTask(null);
            // 追加・更新した行へカーソルを移す(キーボードの日付変更時と同じく、
            // 操作した行がそのまま次のキー操作の起点になるように。Issue #36)
            focusRow(t.id);
            showToast(formIsNew ? `追加: ${t.title}` : `更新: ${t.title}`, true);
          }}
          onDelete={(id) => {
            // 削除した行の位置に次の行を繰り上げてカーソルを残す(無ければ1つ上へ)
            const idx = visibleTasks.findIndex((t) => t.id === id);
            const nextFocus = visibleTasks[idx + 1] ?? visibleTasks[idx - 1];
            pushUndo("削除");
            remove(id);
            setFocusedId(nextFocus ? nextFocus.id : null);
            setFormTask(null);
            showToast("削除しました", true);
          }}
          onClose={() => setFormTask(null)}
        />
      )}
      {interruptTarget && (
        <InterruptDialog
          task={interruptTarget}
          onConfirm={handleInterruptConfirm}
          onClose={() => setInterruptTarget(null)}
        />
      )}
      {startTarget && (
        <TimeInputDialog
          title="タスク開始"
          message={`「${startTarget.title}」の開始時刻を入力してください`}
          // 初期値は常に現在時刻(Issue #19: 予定時刻だと実運用で使いにくい)。
          // 予定どおり始めたいときは下のボタンで開始予定時刻を1クリックで入れられる
          defaultValue={nowHHMM()}
          quickButtons={[
            ...(startTarget.planStart
              ? [{ label: `開始予定 (${startTarget.planStart})`, value: startTarget.planStart }]
              : []),
            {
              label: `続き時間 (${lastEndTimeOfDay(tasks, startTarget.date ?? todayStr()) ?? "―"})`,
              value: lastEndTimeOfDay(tasks, startTarget.date ?? todayStr()) ?? "",
            },
          ]}
          confirmLabel="開始"
          onConfirm={(time) => doStart(startTarget, time)}
          onClose={() => setStartTarget(null)}
        />
      )}
      {endTarget && (
        <TimeInputDialog
          title="タスク終了"
          message={`「${endTarget.title}」の終了時刻を入力してください`}
          // 終了は現在時刻を初期値に。ボタンで終了予定(開始予定+見積)を入れられる(Excel版 EndTask)
          defaultValue={nowHHMM()}
          quickButtons={[
            { label: `終了予定 (${planEnd(endTarget) ?? "―"})`, value: planEnd(endTarget) ?? "" },
          ]}
          confirmLabel="終了"
          onConfirm={(time) => doEnd(endTarget, time)}
          onClose={() => setEndTarget(null)}
        />
      )}
      {seqOpen && (
        <TimeInputDialog
          title="連続開始時刻の設定"
          message={`選択した ${selectedIds.length} 件に、選択した順で見積を積み上げて開始予定時刻を割り当てます。最初の開始時刻を入力してください。`}
          defaultValue={nowHHMM()}
          confirmLabel="設定"
          onConfirm={doSequentialStart}
          onClose={() => setSeqOpen(false)}
        />
      )}
      {bulkOpen && (
        <BulkEditDialog
          count={selectedIds.length}
          categories={categories}
          onApply={applyBulk}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {bulkAddOpen && (
        <BulkAddDialog
          defaultDate={selectedDate}
          onRegister={handleBulkAdd}
          onClose={() => setBulkAddOpen(false)}
        />
      )}
      {importResult && (
        <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} />
      )}

      {/* トースト通知。undo/redo は Ctrl+Z / Ctrl+Y でも操作できる(Issue #14 / #39) */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg">
          <span>{toast.text}</span>
          {toast.action === "undo" && (
            <button
              className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/25"
              onClick={performUndo}
              title="元に戻す(Ctrl+Z)"
            >
              ↩ 元に戻す
            </button>
          )}
          {toast.action === "redo" && (
            <button
              className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/25"
              onClick={performRedo}
              title="やり直す(Ctrl+Y)"
            >
              ↪ やり直す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
