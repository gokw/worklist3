// ==============================================================
// タスク追加・編集フォーム(モーダル)
// 繰り返し設定はExcel版の記号入力を廃止し、フォームUIで指定する
// ==============================================================
import { useEffect, useState } from "react";
import type { RepeatConfig, Task, TaskScope } from "../types";
import { ALL_IMPORTANCES, REPEAT_UNIT_LABELS, SCOPE_LABELS, WEEKDAY_LABELS } from "../types";
import TimeField from "./TimeField";
import CategoryInput from "./CategoryInput";

interface Props {
  task: Task;
  isNew: boolean;
  categories: string[];
  /** タイトルから類似タスクのカテゴリを推測(Issue #2。無ければ空文字) */
  suggestCategory: (title: string) => string;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const inputCls =
  "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";
const labelCls = "block text-xs font-semibold text-gray-500 mb-0.5";

export default function TaskForm({
  task,
  isNew,
  categories,
  suggestCategory,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Task>({ ...task, memos: [...task.memos], links: [...task.links] });
  const [repeatOn, setRepeatOn] = useState(!!task.repeat);
  const [repeat, setRepeat] = useState<RepeatConfig>(
    task.repeat ?? { mode: "schedule", unit: "day", interval: 1, copyPlanStart: false }
  );
  // カテゴリをユーザーが自分で触ったか(触るまではタイトルから自動推測する)
  const [categoryTouched, setCategoryTouched] = useState(!isNew || task.category !== "");

  // 新規タスクで未タッチのうちは、タイトルに応じてカテゴリを自動セット(Issue #2)
  useEffect(() => {
    if (isNew && !categoryTouched) {
      const s = suggestCategory(draft.title);
      setDraft((d) => (d.category === s ? d : { ...d, category: s }));
    }
  }, [draft.title, isNew, categoryTouched, suggestCategory]);

  // Escで閉じる
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const set = <K extends keyof Task>(key: K, value: Task[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setMemo = (i: number, v: string) =>
    setDraft((d) => {
      const memos = [...d.memos];
      memos[i] = v;
      return { ...d, memos };
    });

  const setLink = (i: number, v: string) =>
    setDraft((d) => {
      const links = [...d.links];
      links[i] = v;
      return { ...d, links };
    });

  const submit = () => {
    if (draft.title.trim() === "") {
      alert("タスク名を入力してください");
      return;
    }
    onSave({
      ...draft,
      title: draft.title.trim(),
      repeat: repeatOn ? repeat : undefined,
      links: draft.links.map((l) => l.trim()).filter((l) => l !== ""),
      updatedAt: new Date().toISOString(),
    });
  };

  const toggleWeekday = (w: number) => {
    const cur = repeat.weekdays ?? [];
    setRepeat({
      ...repeat,
      weekdays: cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl mt-6"
        // フォーム内のどこにフォーカスがあっても Ctrl/⌘+Enter で一発保存
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h2 className="mb-3 text-lg font-bold text-gray-800">
          {isNew ? "タスクを追加" : "タスクを編集"}
        </h2>

        {/* タスク名 */}
        <div className="mb-3">
          <label className={labelCls}>タスク名 *</label>
          <input
            autoFocus
            className={inputCls}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="やること・やりたいことを自由に書き出す"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> で保存 / <kbd>Esc</kbd> で閉じる
          </p>
        </div>

        {/* トグル類: 仕事/個人 と 待ち */}
        <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <label className={labelCls}>仕事 / 個人</label>
            <div className="flex gap-1">
              {(["work", "personal"] as TaskScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("scope", s)}
                  className={`rounded px-4 py-1.5 text-sm font-semibold ${
                    draft.scope === s
                      ? s === "work"
                        ? "bg-blue-600 text-white"
                        : "bg-emerald-600 text-white"
                      : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  {s === "work" ? "💼 " : "🏠 "}
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>待ち</label>
            <label className="flex h-[34px] items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.waiting}
                onChange={(e) => set("waiting", e.target.checked)}
              />
              待ち(他の人待ち等)
            </label>
          </div>
        </div>

        {/* 基本情報 */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className={labelCls}>カテゴリ(分類・集計用)</label>
            <CategoryInput
              value={draft.category}
              categories={categories}
              onChange={(v) => set("category", v)}
              onTouch={() => setCategoryTouched(true)}
              className={inputCls}
              placeholder="運用業務 / 稟議チェック 等"
            />
            {isNew && !categoryTouched && draft.category && (
              <p className="mt-0.5 text-[11px] text-gray-400">
                タイトルから推測: {draft.category}(変更できます)
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>重要度</label>
            <select
              className={inputCls}
              value={draft.importance}
              onChange={(e) => set("importance", e.target.value as Task["importance"])}
            >
              {ALL_IMPORTANCES.map((imp) => (
                <option key={imp} value={imp}>
                  {imp}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>見積時間(分)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={draft.estimateMin}
              onChange={(e) => set("estimateMin", Math.max(0, Number(e.target.value)))}
            />
          </div>
        </div>

        {/* 予定(いつやるか・いつまでに) */}
        <fieldset className="mb-4 rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-semibold text-gray-500">予定</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>日付(いつやるか)</label>
              <input
                type="date"
                className={inputCls}
                value={draft.date ?? ""}
                onChange={(e) => set("date", e.target.value || undefined)}
              />
              <p className="mt-0.5 text-[11px] text-gray-400">空=毎日の一覧に表示</p>
            </div>
            <div>
              <label className={labelCls}>開始予定時刻</label>
              <TimeField
                className={inputCls}
                value={draft.planStart}
                onChange={(v) => set("planStart", v)}
              />
              <p className="mt-0.5 text-[11px] text-gray-400">数字4桁(例 0930)</p>
            </div>
            <div>
              <label className={labelCls}>期限(いつまでに)</label>
              <input
                type="date"
                className={inputCls}
                value={draft.deadline ?? ""}
                onChange={(e) => set("deadline", e.target.value || undefined)}
              />
            </div>
          </div>
        </fieldset>

        {/* 実績(記録) */}
        <fieldset className="mb-4 rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-semibold text-gray-500">実績(記録)</legend>
          <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
            <div>
              <label className={labelCls}>開始実績</label>
              <TimeField
                className={inputCls}
                value={draft.actStart}
                onChange={(v) => set("actStart", v)}
              />
            </div>
            <div>
              <label className={labelCls}>終了実績</label>
              <TimeField
                className={inputCls}
                value={draft.actEnd}
                onChange={(v) => set("actEnd", v)}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            通常は一覧の S(開始)/ E(終了)ボタンで自動入力されます。ここでは手直しできます。
          </p>
        </fieldset>

        {/* 繰り返し設定 */}
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={repeatOn}
              onChange={(e) => setRepeatOn(e.target.checked)}
            />
            繰り返しタスクにする
          </label>
          {repeatOn && (
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded border border-gray-300 px-2 py-1"
                  value={repeat.mode}
                  onChange={(e) =>
                    setRepeat({ ...repeat, mode: e.target.value as RepeatConfig["mode"] })
                  }
                >
                  <option value="schedule">定期(予定日基準)</option>
                  <option value="afterComplete">完了から起算</option>
                </select>
                <input
                  type="number"
                  min={1}
                  className="w-16 rounded border border-gray-300 px-2 py-1"
                  value={repeat.interval}
                  onChange={(e) =>
                    setRepeat({ ...repeat, interval: Math.max(1, Number(e.target.value)) })
                  }
                />
                <select
                  className="rounded border border-gray-300 px-2 py-1"
                  value={repeat.unit}
                  onChange={(e) =>
                    setRepeat({ ...repeat, unit: e.target.value as RepeatConfig["unit"] })
                  }
                >
                  {(Object.keys(REPEAT_UNIT_LABELS) as RepeatConfig["unit"][]).map((u) => (
                    <option key={u} value={u}>
                      {REPEAT_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
                <span className="text-gray-500">
                  {repeat.mode === "schedule" ? "ごと" : "後に次を生成"}
                </span>
              </div>
              {repeat.unit === "week" && (
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-xs text-gray-500">曜日指定:</span>
                  {WEEKDAY_LABELS.map((label, w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => toggleWeekday(w)}
                      className={`h-7 w-7 rounded-full text-xs font-semibold ${
                        repeat.weekdays?.includes(w)
                          ? "bg-blue-600 text-white"
                          : "bg-white border border-gray-300 text-gray-500"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={repeat.copyPlanStart}
                  onChange={(e) => setRepeat({ ...repeat, copyPlanStart: e.target.checked })}
                />
                次回タスクに開始予定時刻を引き継ぐ
              </label>
            </div>
          )}
        </div>

        {/* リンク(最大5件) */}
        <div className="mb-3">
          <label className={labelCls}>リンク(最大5件)</label>
          <div className="space-y-1">
            {[...Array(Math.min(Math.max(draft.links.length + 1, 1), 5))].map((_, i) => (
              <input
                key={i}
                className={inputCls}
                type="url"
                placeholder="https://..."
                value={draft.links[i] ?? ""}
                onChange={(e) => setLink(i, e.target.value)}
              />
            ))}
          </div>
        </div>

        {/* メモ(3つ) */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <label className={labelCls}>メモ{i + 1}</label>
              <textarea
                className={`${inputCls} h-16 resize-none`}
                value={draft.memos[i] ?? ""}
                onChange={(e) => setMemo(i, e.target.value)}
              />
            </div>
          ))}
        </div>

        {/* ボタン */}
        <div className="flex items-center justify-between">
          <div>
            {!isNew && (
              <button
                className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                onClick={() => {
                  if (confirm("このタスクを削除しますか？")) onDelete(draft.id);
                }}
              >
                削除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={submit}
              title="Ctrl+Enter でも保存できます"
            >
              保存 (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
