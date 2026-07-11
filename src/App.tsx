// ==============================================================
// worklist3 アプリ本体
//   状態管理・フィルタ・ショートカットキー・各ダイアログの制御
// ==============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutMode, Task, ViewMode } from "./types";
import { formatMin, nowHHMM, todayStr } from "./lib/date";
import {
  actMin,
  createPrepTask,
  createTask,
  endTask,
  interruptTask,
  remainMin,
  setSequentialStart,
  splitTask,
  startTask,
} from "./lib/logic";
import { parseClipboardText } from "./lib/clipboard";
import { sortTasks } from "./lib/sort";
import { exportTasksAsJson, repository } from "./lib/storage";
import Toolbar from "./components/Toolbar";
import TaskTable from "./components/TaskTable";
import TaskCards from "./components/TaskCards";
import TaskForm from "./components/TaskForm";
import InterruptDialog from "./components/InterruptDialog";
import SplitDialog from "./components/SplitDialog";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => repository.load());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState<ViewMode>("dayAll");
  const [layout, setLayout] = useState<LayoutMode>(
    () => (localStorage.getItem("worklist3.layout") as LayoutMode) || "table"
  );
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ダイアログ状態
  const [formTask, setFormTask] = useState<Task | null>(null);
  const [formIsNew, setFormIsNew] = useState(true);
  const [interruptTarget, setInterruptTarget] = useState<Task | null>(null);
  const [splitTarget, setSplitTarget] = useState<Task | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  // 保存(タスクが変わるたびに localStorage へ)
  useEffect(() => {
    repository.save(tasks);
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("worklist3.layout", layout);
  }, [layout]);

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

  // ---------- フィルタ・並び替え ----------
  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (viewMode === "dayAll") {
      // その日のタスクすべて = 日付一致 + 日付未設定(毎日扱い)
      list = list.filter((t) => !t.date || t.date === selectedDate);
    } else if (viewMode === "dayPlanned") {
      // その日の予定 = 日時(日付+時刻)が設定されているもののみ
      list = list.filter((t) => t.date === selectedDate && !!t.planStart);
    }
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    if (!showDone) list = list.filter((t) => t.status !== "done");
    return sortTasks(list);
  }, [tasks, viewMode, selectedDate, categoryFilter, showDone]);

  const categories = useMemo(
    () => [...new Set(tasks.map((t) => t.category).filter(Boolean))].sort(),
    [tasks]
  );

  // その日の集計(Excel版 B2:B4 相当)
  const totals = useMemo(() => {
    const dayTasks = tasks.filter((t) => !t.date || t.date === selectedDate);
    return {
      estimate: dayTasks.filter((t) => t.status !== "done").reduce((s, t) => s + t.estimateMin, 0),
      actual: dayTasks.reduce((s, t) => s + (actMin(t) ?? 0), 0),
      remain: dayTasks.reduce((s, t) => s + (t.status === "done" ? 0 : remainMin(t)), 0),
    };
  }, [tasks, selectedDate]);

  // ---------- タスク操作 ----------
  const openNewForm = useCallback(
    (initial?: Partial<Task>) => {
      setFormTask(createTask({ date: selectedDate, ...initial }));
      setFormIsNew(true);
    },
    [selectedDate]
  );

  const openEditForm = useCallback((task: Task) => {
    setFormTask(task);
    setFormIsNew(false);
  }, []);

  const handleStart = useCallback(
    (task: Task) => {
      upsert([startTask(task)]);
      showToast(`▶ 開始: ${task.title} (${nowHHMM()})`);
    },
    [upsert, showToast]
  );

  const handleEnd = useCallback(
    (task: Task) => {
      const { updated, next } = endTask(task);
      upsert(next ? [updated, next] : [updated]);
      showToast(
        next
          ? `■ 完了: ${task.title} → 次回 ${next.date} に生成しました`
          : `■ 完了: ${task.title}`
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

  const handlePrep = useCallback(
    (task: Task) => {
      const input = window.prompt(`「${task.title}」の準備時間(分)を入力してください`, "15");
      if (input === null) return;
      const min = Number(input);
      if (Number.isNaN(min) || min <= 0) {
        showToast("数値(分)を入力してください");
        return;
      }
      upsert([createPrepTask(task, min)]);
      showToast(`準備タスクを追加しました(${min}分)`);
    },
    [upsert, showToast]
  );

  const handleSplitConfirm = useCallback(
    (children: { title: string; estimateMin: number }[]) => {
      if (!splitTarget) return;
      upsert(splitTask(splitTarget, children));
      setSplitTarget(null);
      showToast(`${children.length}件の子タスクに分割しました`);
    },
    [splitTarget, upsert, showToast]
  );

  const handleStatusChange = useCallback(
    (task: Task, status: Task["status"]) => {
      let updated: Task = { ...task, status, updatedAt: new Date().toISOString() };
      // ステータス直接変更でも実績を最低限整合させる
      if (status === "inProgress" && !task.actStart) updated = startTask(task);
      if (status === "done" && !task.actEnd && task.actStart) {
        handleEnd(task);
        return;
      }
      upsert([updated]);
    },
    [upsert, handleEnd]
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
      setFormTask(task);
      setFormIsNew(true);
    } catch {
      showToast("クリップボードを読み取れませんでした(ブラウザの許可が必要です)");
    }
  }, [showToast]);

  // ランダム開始(Excel版 StartRandomTodayTask 踏襲)
  const handleRandomStart = useCallback(() => {
    const candidates = tasks.filter(
      (t) =>
        (!t.date || t.date === selectedDate) &&
        !t.planStart &&
        !t.actStart &&
        t.status === "notStarted"
    );
    if (candidates.length === 0) {
      showToast("該当するタスクが見つかりませんでした");
      return;
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    handleStart(picked);
  }, [tasks, selectedDate, handleStart, showToast]);

  // 連続開始時刻セット(Excel版 SetSequentialStartHHMM 踏襲)
  const handleSequentialStart = useCallback(() => {
    const targets = visibleTasks.filter((t) => selectedIds.has(t.id));
    if (targets.length === 0) return;
    const input = window.prompt("最初の開始時刻を入力してください(HH:MM)", nowHHMM());
    if (input === null) return;
    if (!/^\d{1,2}:\d{2}$/.test(input.trim())) {
      showToast("HH:MM形式で入力してください(例 09:30)");
      return;
    }
    upsert(setSequentialStart(targets, input.trim()));
    setSelectedIds(new Set());
    showToast(`${targets.length}件に連続の開始予定時刻を設定しました`);
  }, [visibleTasks, selectedIds, upsert, showToast]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---------- ショートカットキー ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 入力中・ダイアログ表示中は無効
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (formTask || interruptTarget || splitTarget) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openNewForm();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

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
        case "arrowleft": {
          const d = new Date(selectedDate);
          d.setDate(d.getDate() - 1);
          setSelectedDate(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
          );
          break;
        }
        case "arrowright": {
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
  }, [formTask, interruptTarget, splitTarget, openNewForm, handleClipboardImport, selectedDate]);

  // ---------- 描画 ----------
  const actionHandlers = {
    onStart: handleStart,
    onEnd: handleEnd,
    onInterrupt: setInterruptTarget,
    onPrep: handlePrep,
    onSplit: setSplitTarget,
    onEdit: openEditForm,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Toolbar
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
        selectedCount={selectedIds.size}
        onExport={() => exportTasksAsJson(tasks)}
        totals={totals}
      />

      <main className="mx-auto max-w-7xl p-4">
        {layout === "table" ? (
          <TaskTable
            tasks={visibleTasks}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onStatusChange={handleStatusChange}
            {...actionHandlers}
          />
        ) : (
          <TaskCards tasks={visibleTasks} {...actionHandlers} />
        )}

        <p className="mt-6 text-center text-[11px] text-gray-400">
          ショートカット: <kbd>N</kbd> 新規追加 / <kbd>V</kbd> クリップボード取込 /{" "}
          <kbd>T</kbd> 表⇔カード切替 / <kbd>←</kbd><kbd>→</kbd> 日付移動
        </p>
      </main>

      {/* ダイアログ類 */}
      {formTask && (
        <TaskForm
          task={formTask}
          isNew={formIsNew}
          categories={categories}
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
      {splitTarget && (
        <SplitDialog
          task={splitTarget}
          onConfirm={handleSplitConfirm}
          onClose={() => setSplitTarget(null)}
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
