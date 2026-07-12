// ==============================================================
// worklist3 アプリ本体
//   状態管理・フィルタ・ショートカットキー・各ダイアログの制御
// ==============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutMode, Task, TaskScope, ViewMode, WorkMode } from "./types";
import { WORK_MODE_LABELS } from "./types";
import { addToDate, formatMin, nowHHMM, todayStr } from "./lib/date";
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
  remainMin,
  suggestCategoryByTitle,
  setSequentialStart,
  startTask,
  toggleWaiting,
} from "./lib/logic";
import { parseClipboardText } from "./lib/clipboard";
import { sortTasks } from "./lib/sort";
import { exportTasksAsJson, repository } from "./lib/storage";
import Toolbar from "./components/Toolbar";
import TaskTable from "./components/TaskTable";
import TaskCards from "./components/TaskCards";
import TaskForm from "./components/TaskForm";
import InterruptDialog from "./components/InterruptDialog";
import TimeInputDialog from "./components/TimeInputDialog";
import BulkEditDialog, { type BulkChanges } from "./components/BulkEditDialog";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => repository.load());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState<ViewMode>("todayOnward");
  const [layout, setLayout] = useState<LayoutMode>(
    () => (localStorage.getItem("worklist3.layout") as LayoutMode) || "table"
  );
  const [categoryFilter, setCategoryFilter] = useState("");
  // 今日/今日以降/予定では完了を既定で隠す(やることに集中。トグルで表示可)
  const [showDone, setShowDone] = useState(false);
  // 選択したタスクID。選択した順を保つため配列で持つ(連続時刻を選択順に設定するため)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** キーボード操作のカーソル位置(Excel版のアクティブセル行に相当) */
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // 仕事/個人モード(前回のモードを記憶)。scope を絞り込むビュー
  const [mode, setMode] = useState<WorkMode>(() => {
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
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  // 保存(タスクが変わるたびに localStorage へ)
  useEffect(() => {
    repository.save(tasks);
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("worklist3.layout", layout);
  }, [layout]);

  useEffect(() => {
    localStorage.setItem("worklist3.mode", mode);
  }, [mode]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3000);
  }, []);

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

  // インライン編集の保存(1件更新)
  const handleUpdateTask = useCallback((t: Task) => upsert([t]), [upsert]);

  // ---------- フィルタ・並び替え ----------
  /** 現在のモード(仕事/個人/すべて)で表示すべきタスクか。タスク自身の scope で判定 */
  const matchesMode = useCallback(
    (t: Task) => mode === "all" || t.scope === mode,
    [mode]
  );

  const visibleTasks = useMemo(() => {
    const today = todayStr();
    // 繰越 = 前日以前の日付で、まだ終わっていないタスク(忘れ防止で今日系ビューに出す)
    const isCarryover = (t: Task) => !!t.date && t.date < today && !t.actEnd;

    let list = tasks.filter(matchesMode);
    switch (viewMode) {
      case "today":
        // 選択日のタスク(日付一致＋毎日)。選択日が今日なら繰越も混ぜる
        list = list.filter(
          (t) =>
            !t.date ||
            t.date === selectedDate ||
            (selectedDate === today && isCarryover(t))
        );
        break;
      case "todayOnward":
        // 今日以降(＋毎日)＋繰越
        list = list.filter((t) => !t.date || t.date >= today || isCarryover(t));
        break;
      case "planned":
        // 今日以降で開始予定時刻あり ＋ 繰越(忘れ防止)
        list = list.filter(
          (t) => (!!t.planStart && (!t.date || t.date >= today)) || isCarryover(t)
        );
        break;
      case "done":
        list = list.filter((t) => !!t.actEnd);
        break;
      case "everything":
        break;
    }
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    // 完了の表示制御: done は完了のみ / everything は全部 / それ以外はトグル次第
    if (viewMode !== "done" && viewMode !== "everything" && !showDone) {
      list = list.filter((t) => !t.actEnd);
    }
    return sortTasks(list);
  }, [tasks, viewMode, selectedDate, categoryFilter, showDone, matchesMode]);

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
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showToast("クリップボードが空です");
        return;
      }
      const { kind, task } = parseClipboardText(text);
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
  const changeView = useCallback((v: ViewMode) => {
    setViewMode(v);
    if (v === "today") setSelectedDate(todayStr());
  }, []);

  const toggleSelect = useCallback((id: string) => {
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
      // カーソル行が画面外なら追従スクロール
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-task-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    },
    [visibleTasks, focusedId]
  );

  // ---------- ショートカットキー ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 入力中・ダイアログ表示中は無効
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // ボタン上のEnter/Spaceはボタン自体の動作を優先(二重発火防止)
      if ((tag === "BUTTON" || tag === "A") && (e.key === "Enter" || e.key === " ")) return;
      if (formTask || interruptTarget || startTarget || endTarget || seqOpen || bulkOpen)
        return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openNewForm();
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
        case "t":
          e.preventDefault();
          setLayout((l) => (l === "table" ? "cards" : "table"));
          break;
        case "m": // 仕事/個人/すべて モード巡回
          e.preventDefault();
          cycleMode();
          break;
        case "arrowup":
          e.preventDefault();
          moveFocus(-1);
          break;
        case "arrowdown":
          e.preventDefault();
          moveFocus(1);
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
        case "enter": // 編集
          if (!focused) break;
          e.preventDefault();
          openEditForm(focused);
          break;
        case " ": // 連続時刻設定などの選択トグル
          if (!focused) break;
          e.preventDefault();
          toggleSelect(focused.id);
          break;
        case "delete":
          if (!focused) break;
          e.preventDefault();
          if (confirm(`「${focused.title}」を削除しますか？`)) {
            remove(focused.id);
            showToast("削除しました");
          }
          break;
        case "arrowleft": {
          // 日付移動は「今日」ビューで効くので、必要なら切替える
          setViewMode("today");
          const d = new Date(selectedDate);
          d.setDate(d.getDate() - 1);
          setSelectedDate(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
          );
          break;
        }
        case "arrowright": {
          setViewMode("today");
          const d = new Date(selectedDate);
          d.setDate(d.getDate() + 1);
          setSelectedDate(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
          );
          break;
        }
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
    openNewForm,
    handleClipboardImport,
    selectedDate,
    visibleTasks,
    focusedId,
    moveFocus,
    handleStart,
    handleEnd,
    handleToggleWait,
    handleCopy,
    openEditForm,
    toggleSelect,
    remove,
    showToast,
    cycleMode,
  ]);

  // ---------- 描画 ----------
  const actionHandlers = {
    onStart: handleStart,
    onEnd: handleEnd,
    onInterrupt: setInterruptTarget,
    onCopy: handleCopy,
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
        layout={layout}
        onLayoutChange={setLayout}
        categories={categories}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        showDone={showDone}
        onShowDoneChange={setShowDone}
        onAdd={() => openNewForm()}
        onClipboardImport={handleClipboardImport}
        onRandomStart={handleRandomStart}
        onSequentialStart={handleSequentialStart}
        onBulkEdit={() => selectedIds.length > 0 && setBulkOpen(true)}
        onSelectAllVisible={selectAllVisible}
        onClearSelection={clearSelection}
        selectedCount={selectedIds.length}
        onExport={() => exportTasksAsJson(tasks)}
        totals={totals}
      />

      <main className="mx-auto max-w-7xl p-4">
        {layout === "table" ? (
          <TaskTable
            tasks={visibleTasks}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleWait={handleToggleWait}
            onUpdateTask={handleUpdateTask}
            focusedId={focusedId}
            onFocusTask={setFocusedId}
            {...actionHandlers}
          />
        ) : (
          <TaskCards
            tasks={visibleTasks}
            selectedIds={selectedIds}
            onToggleWait={handleToggleWait}
            focusedId={focusedId}
            onFocusTask={setFocusedId}
            {...actionHandlers}
          />
        )}

        <p className="mt-6 text-center text-[11px] text-gray-400">
          <kbd>↑</kbd><kbd>↓</kbd> タスク選択 / <kbd>S</kbd> 開始・再開 / <kbd>E</kbd> 終了 /{" "}
          <kbd>I</kbd> 中断 / <kbd>W</kbd> 待ちON/OFF(完了タスクは待ちとして複製) /{" "}
          <kbd>C</kbd> コピー / <kbd>Enter</kbd> 編集 / <kbd>Space</kbd> 選択 / <kbd>Del</kbd> 削除
          <br />
          <kbd>N</kbd> 新規追加 / <kbd>V</kbd> クリップボード取込 / <kbd>M</kbd> 仕事⇔個人モード /{" "}
          <kbd>T</kbd> 表⇔カード切替 / <kbd>←</kbd><kbd>→</kbd> 日付移動
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
            remove(id);
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

      {/* トースト通知 */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
