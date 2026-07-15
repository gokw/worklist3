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
import { exportTasksAsJson, migrateTask, repository } from "./lib/storage";
import {
  type BackupState,
  backupNow,
  chooseBackupDir,
  disconnectBackupDir,
  getBackupState,
  notifyTasksChanged,
  reconnectBackupDir,
  restoreBackupDir,
  setBackupNotifier,
  subscribeBackup,
} from "./lib/backup";
import { readUrlSettings, writeUrlSettings } from "./lib/urlParams";
import Toolbar from "./components/Toolbar";
import TaskTable, {
  EDIT_ORDER,
  type EditableField,
  type EditingCell,
} from "./components/TaskTable";
// カード形式は一覧から外した(types.ts 参照)。戻すときはこの import と下の描画分岐を復活させる
// import TaskCards from "./components/TaskCards";
import TaskForm from "./components/TaskForm";
import InterruptDialog from "./components/InterruptDialog";
import TimeInputDialog from "./components/TimeInputDialog";
import BulkEditDialog, { type BulkChanges } from "./components/BulkEditDialog";
import BulkAddDialog from "./components/BulkAddDialog";
import ImportResultDialog, { type ImportResult } from "./components/ImportResultDialog";
import type { ParsedRow } from "./lib/bulkParse";

// URLクエリ → localStorage → 既定 の順に初期値を決める(Issue #4)
const urlInit = readUrlSettings();

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
  const [toast, setToast] = useState("");
  const [backupState, setBackupState] = useState<BackupState>(getBackupState);
  const toastTimer = useRef<number | undefined>(undefined);
  /** 起動時1回だけ走る副作用から最新のタスクを見るための控え */
  const tasksRef = useRef(tasks);

  // 保存(タスクが変わるたびに localStorage へ)。
  // 同期フォルダへの控えはデバウンス付きの非同期なので、この主経路は止めない
  useEffect(() => {
    tasksRef.current = tasks;
    repository.save(tasks);
    notifyTasksChanged(tasks);
  }, [tasks]);

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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3000);
  }, []);

  // バックアップ層との接続: 状態の購読・トーストの差し込み・保存先の復元(起動時1回)
  useEffect(() => {
    setBackupNotifier(showToast);
    const unsubscribe = subscribeBackup(setBackupState);
    void restoreBackupDir(tasksRef.current);
    return unsubscribe;
  }, [showToast]);

  // ---------- 更新ヘルパー ----------
  const upsert = useCallback((updated: Task[]) => {
    setTasks((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of updated) map.set(t.id, t);
      return [...map.values()];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const removeMany = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setTasks((prev) => prev.filter((t) => !idSet.has(t.id)));
  }, []);

  // インライン編集の保存(1件更新)
  const handleUpdateTask = useCallback((t: Task) => upsert([t]), [upsert]);

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

  const visibleTasks = useMemo(() => {
    const today = todayStr();
    // 繰越 = 前日以前の日付で、まだ終わっていないタスク(忘れ防止で今日系ビューに出す)
    const isCarryover = (t: Task) => !!t.date && t.date < today && !t.actEnd;

    let list = tasks.filter(matchesMode);
    // 1. 期間
    switch (viewMode) {
      case "todayOnward":
        // 今日以降(＋毎日)＋繰越
        list = list.filter((t) => !t.date || t.date >= today || isCarryover(t));
        break;
      case "today":
        // 選択日のタスク(日付一致＋毎日)。選択日が今日なら繰越も混ぜる
        list = list.filter(
          (t) =>
            !t.date ||
            t.date === selectedDate ||
            (selectedDate === today && isCarryover(t))
        );
        break;
      case "custom":
        // 指定範囲の日付のみ(繰越は混ぜない)。片側が空ならその側は無制限。
        // 日付なし(毎日のタスク)は特定の期間に属さないので範囲指定では出さない
        list = list.filter(
          (t) => !!t.date && (!customFrom || t.date >= customFrom) && (!customTo || t.date <= customTo)
        );
        break;
      case "everything":
        break;
    }
    // 2. 完了の扱い
    if (doneFilter === "onlyDone") list = list.filter((t) => !!t.actEnd);
    else if (doneFilter === "hideDone") list = list.filter((t) => !t.actEnd);
    // 3. 予定のみ(開始予定時刻が入っているものだけ)
    if (plannedOnly) list = list.filter((t) => !!t.planStart);
    // 4. カテゴリ
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    // 5. タスク名
    if (titleMatcher) list = list.filter((t) => titleMatcher(t.title));
    return sortTasks(list);
  }, [
    tasks,
    viewMode,
    selectedDate,
    customFrom,
    customTo,
    doneFilter,
    plannedOnly,
    categoryFilter,
    titleMatcher,
    matchesMode,
  ]);

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
        })
      );
      if (created.length > 0) upsert(created);
      setBulkAddOpen(false);
      showToast(`${created.length}件を登録しました`);
    },
    [defaultScope, upsert, showToast]
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
        if (write.length > 0) upsert(write);
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
    [tasks, upsert, showToast]
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
      upsert([startTask(task, time)]);
      setStartTarget(null);
      showToast(`▶ 開始: ${task.title} (${time})`);
    },
    [upsert, showToast]
  );

  // 終了も時刻入力ダイアログを開き、確定した時刻で終了する(Excel版 EndTask 踏襲)
  const handleEnd = useCallback((task: Task) => {
    setEndTarget(task);
  }, []);

  const doEnd = useCallback(
    (task: Task, time: string) => {
      const { updated, next } = endTask(task, time);
      upsert(next ? [updated, next] : [updated]);
      setEndTarget(null);
      showToast(
        next
          ? `■ 完了: ${task.title} (${time}) → 次回 ${next.date} に生成しました`
          : `■ 完了: ${task.title} (${time})`
      );
    },
    [upsert, showToast]
  );

  const handleInterruptConfirm = useCallback(
    (title: string | undefined, estimate: number) => {
      if (!interruptTarget) return;
      const { consumed, remainder, interrupt } = interruptTask(interruptTarget, title, estimate);
      upsert(interrupt ? [consumed, remainder, interrupt] : [consumed, remainder]);
      setInterruptTarget(null);
      showToast(
        interrupt
          ? `⚡ 中断し、割込み「${interrupt.title}」を開始しました`
          : `⚡ 中断しました(残り ${formatMin(remainder.estimateMin) || "0m"})`
      );
    },
    [interruptTarget, upsert, showToast]
  );

  // タスクを複製(実行状態はリセットした新規タスク)。Issue #1
  const handleCopy = useCallback(
    (task: Task) => {
      const copy = copyTask(task);
      upsert([copy]);
      setFocusedId(copy.id);
      showToast(`コピーしました: ${task.title}`);
    },
    [upsert, showToast]
  );

  // 定期予定を完了にせず次の日程へ延期(Issue #6)
  const handlePostpone = useCallback(
    (task: Task) => {
      if (!task.repeat) {
        showToast("繰り返し設定のあるタスクだけ延期できます");
        return;
      }
      const moved = postponeTask(task);
      upsert([moved]);
      showToast(`次の日程へ延期しました: ${moved.date}`);
    },
    [upsert, showToast]
  );

  /**
   * 待ちトグル(Excel版 WaitTask 踏襲):
   *   未完了タスク → 待ちフラグのON/OFF
   *   完了タスク   → 待ちタスクとして複製(見積0・実績クリア)
   */
  const handleToggleWait = useCallback(
    (task: Task) => {
      if (task.actEnd) {
        const copy = createWaitCopy(task);
        upsert([copy]);
        setFocusedId(copy.id);
        showToast(`待ちタスクとして複製: ${task.title}`);
      } else {
        const updated = toggleWaiting(task);
        upsert([updated]);
        showToast(updated.waiting ? `待ちON: ${task.title}` : `待ちOFF: ${task.title}`);
      }
    },
    [upsert, showToast]
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
      const kindLabel = { teams: "Teamsリンク", calendar: "予定", plain: "テキスト" }[kind];
      showToast(`${kindLabel}として認識しました。内容を確認して保存してください`);
      // 取込タスクも今のビューの仕事/個人に合わせる
      setFormTask({ ...task, scope: defaultScope });
      setFormIsNew(true);
    } catch {
      showToast("クリップボードを読み取れませんでした(ブラウザの許可が必要です)");
    }
  }, [showToast, defaultScope]);

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
      if (targets.length > 0) upsert(setSequentialStart(targets, firstStart));
      setSeqOpen(false);
      setSelectedIds([]);
      showToast(`${targets.length}件に選択した順で開始予定時刻を設定しました`);
    },
    [tasks, selectedIds, upsert, showToast]
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
      if (updated.length > 0) upsert(updated);
      setBulkOpen(false);
      setSelectedIds([]);
      showToast(`${updated.length}件を一括更新しました`);
    },
    [tasks, selectedIds, upsert, showToast]
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
    const running = visibleTasks.find((t) => derivedStatus(t) === "running");
    if (running) {
      focusRow(running.id);
      return;
    }
    let lastDoneIdx = -1;
    visibleTasks.forEach((t, i) => {
      if (derivedStatus(t) === "done") lastDoneIdx = i;
    });
    if (lastDoneIdx !== -1) {
      focusRow(visibleTasks[Math.min(lastDoneIdx + 1, visibleTasks.length - 1)].id);
      return;
    }
    focusRow(visibleTasks[0].id);
  }, [visibleTasks, focusRow]);

  // ---------- カーソル列移動(←→キー。Excel風セル移動)Issue #5 ----------
  const onFocusCell = useCallback((id: string, field: EditableField) => {
    setFocusedId(id);
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

  // ---------- カーソルタスクの日付を前後(h/l キー。Issue #7 / Excel NextDay・PreviousDay 相当)----------
  const shiftFocusedDate = useCallback(
    (task: Task, delta: number) => {
      const newDate = addToDate(task.date ?? todayStr(), "day", delta);
      upsert([{ ...task, date: newDate, updatedAt: new Date().toISOString() }]);
      showToast(`${task.title || "(無題)"} → ${formatDateJa(newDate)}`);
    },
    [upsert, showToast]
  );

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
        importResult
      )
        return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openNewForm();
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // カーソル位置のタスク(Excel版のアクティブセル行に相当)
      const focused = visibleTasks.find((t) => t.id === focusedId);
      const running = focused && !!focused.actStart && !focused.actEnd;

      switch (e.key.toLowerCase()) {
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
        case "arrowleft": // 表: 左の列へ(Excel風セル移動)Issue #5
          if (layout === "cards") break;
          e.preventDefault();
          moveColumn(-1);
          break;
        case "arrowright": // 表: 右の列へ
          if (layout === "cards") break;
          e.preventDefault();
          moveColumn(1);
          break;
        case "home": // 「今どこをやっているか」へジャンプ: 実行中→無ければ完了の次→無ければ先頭
          e.preventDefault();
          jumpToCurrent();
          break;
        case "h": // カーソルタスクの日付を前日へ(Issue #7)
          if (!focused) break;
          e.preventDefault();
          shiftFocusedDate(focused, -1);
          break;
        case "l": // カーソルタスクの日付を翌日へ
          if (!focused) break;
          e.preventDefault();
          shiftFocusedDate(focused, 1);
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
        case "p": // 定期予定を次の日程へ延期
          if (!focused) break;
          e.preventDefault();
          if (focused.repeat) handlePostpone(focused);
          else showToast("繰り返し設定のあるタスクだけ延期できます");
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
          if (selectedIds.length > 0) {
            // 複数選択があればまとめて削除(選択より後ろの最初の残存行、無ければ前の残存行へカーソル)
            if (confirm(`選択した${selectedIds.length}件を削除しますか？`)) {
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
              removeMany(selectedIds);
              setSelectedIds([]);
              setAnchorId(null);
              setFocusedId(nextFocus ? nextFocus.id : null);
              showToast(`${selectedIds.length}件を削除しました`);
            }
            break;
          }
          if (!focused) break;
          if (confirm(`「${focused.title}」を削除しますか？`)) {
            // 削除した行の位置に次の行を繰り上げてカーソルを残す(無ければ1つ上へ)
            const idx = visibleTasks.findIndex((t) => t.id === focused.id);
            const nextFocus = visibleTasks[idx + 1] ?? visibleTasks[idx - 1];
            remove(focused.id);
            setFocusedId(nextFocus ? nextFocus.id : null);
            showToast("削除しました");
          }
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
    openNewForm,
    handleClipboardImport,
    visibleTasks,
    focusedId,
    focusedField,
    layout,
    moveFocus,
    moveColumn,
    extendSelection,
    shiftFocusedDate,
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
    remove,
    removeMany,
    showToast,
    cycleMode,
  ]);

  // ---------- 描画 ----------
  const actionHandlers = {
    onStart: handleStart,
    onEnd: handleEnd,
    onInterrupt: setInterruptTarget,
    onCopy: handleCopy,
    onPostpone: handlePostpone,
    onEdit: openEditForm,
  };

  return (
    <div className="min-h-screen bg-gray-50">
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
        onSelectAllVisible={selectAllVisible}
        onClearSelection={clearSelection}
        selectedCount={selectedIds.length}
        onExport={() => exportTasksAsJson(tasks)}
        onImportFile={handleImportFile}
        backup={backupState}
        onChooseBackupDir={() => void chooseBackupDir(tasks)}
        onReconnectBackupDir={() => void reconnectBackupDir(tasks)}
        onDisconnectBackupDir={() => void disconnectBackupDir()}
        onBackupNow={() => void backupNow(tasks)}
        totals={totals}
      />

      {/* 表示形式は「表ライト」のみ。カード形式(TaskCards)は一覧から外した(types.ts 参照)。
          戻すときは max-w の出し分けと TaskCards の分岐をここに復活させる */}
      <main className="mx-auto max-w-none p-4">
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
          onFocusTask={setFocusedId}
          editing={editingCell}
          onEditingChange={setEditingCell}
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

        <p className="mt-6 text-center text-[11px] text-gray-400">
          <kbd>↑</kbd><kbd>↓</kbd> 行移動 / <kbd>←</kbd><kbd>→</kbd> 列移動(表) /{" "}
          <kbd>Ctrl+↑↓</kbd> 次/前のカテゴリへ / <kbd>Home</kbd> 今の作業位置へ /{" "}
          <kbd>Shift</kbd>+<kbd>↑↓</kbd> 範囲選択 / <kbd>H</kbd> 日付-1 / <kbd>L</kbd> 日付+1 /{" "}
          <kbd>Enter</kbd> セル編集(列未選択なら詳細) / <kbd>Ctrl+Enter</kbd> 詳細編集 /{" "}
          <kbd>S</kbd> 開始 / <kbd>E</kbd> 終了 /{" "}
          <kbd>I</kbd> 中断 / <kbd>W</kbd> 待ち / <kbd>C</kbd> コピー / <kbd>P</kbd> 延期 /{" "}
          <kbd>Space</kbd> 選択 / <kbd>Del</kbd> 削除(複数選択時は一括)
          <br />
          <kbd>N</kbd> 新規追加 / <kbd>V</kbd> クリップボード取込 / <kbd>M</kbd> 仕事⇔個人モード /{" "}
          <kbd>T</kbd> 表⇔カード切替
        </p>
      </main>

      {/* ダイアログ類 */}
      {formTask && (
        <TaskForm
          task={formTask}
          isNew={formIsNew}
          categories={categories}
          suggestCategory={(title) => suggestCategoryByTitle(tasks, title)}
          onSave={(t) => {
            upsert([t]);
            setFormTask(null);
            showToast(formIsNew ? `追加: ${t.title}` : `更新: ${t.title}`);
          }}
          onDelete={(id) => {
            // 削除した行の位置に次の行を繰り上げてカーソルを残す(無ければ1つ上へ)
            const idx = visibleTasks.findIndex((t) => t.id === id);
            const nextFocus = visibleTasks[idx + 1] ?? visibleTasks[idx - 1];
            remove(id);
            setFocusedId(nextFocus ? nextFocus.id : null);
            setFormTask(null);
            showToast("削除しました");
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
          // 開始予定があればその時刻、無ければ現在時刻を初期値に(Excel版 StartTask)
          defaultValue={startTarget.planStart ?? nowHHMM()}
          quickButtons={[
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

      {/* トースト通知 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
