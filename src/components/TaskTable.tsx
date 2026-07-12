// ==============================================================
// 表形式ビュー(Excel版 worklist の列構成を踏襲)
//   よく直す列はセルをクリックしてその場で編集(インライン編集)。
//   メモ/リンク/繰り返し等の詳細は ✎ / Enter / 詳細ダイアログで編集する。
// ==============================================================
import { useState } from "react";
import type { ReactNode } from "react";
import type { Importance, Task } from "../types";
import { ALL_IMPORTANCES, DERIVED_STATUS_LABELS, REPEAT_UNIT_LABELS } from "../types";
import { formatDateJa, parseTimeInput } from "../lib/date";
import { actMin, collectCategories, derivedStatus, planEnd, remainMin } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
import EditableCell, { type FinishReason } from "./EditableCell";
import CategoryInput from "./CategoryInput";
import {
  deadlineTextClass,
  importanceBadgeClass,
  statusBadgeClass,
  taskBgClass,
} from "./rowStyle";

/** インライン編集できる項目(Tab移動の並び順もこの順) */
type EditableField =
  | "date"
  | "title"
  | "importance"
  | "estimateMin"
  | "planStart"
  | "actStart"
  | "actEnd"
  | "deadline"
  | "category";

const EDIT_ORDER: EditableField[] = [
  "date",
  "title",
  "importance",
  "estimateMin",
  "planStart",
  "actStart",
  "actEnd",
  "deadline",
  "category",
];

interface Props extends TaskActionHandlers {
  tasks: Task[];
  /** 選択中のタスクID(選択した順) */
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  /** 待ちフラグのトグル(完了タスクは待ちタスクとして複製) */
  onToggleWait: (task: Task) => void;
  /** インライン編集の結果を保存 */
  onUpdateTask: (task: Task) => void;
  /** キーボードカーソル位置のタスクID */
  focusedId: string | null;
  onFocusTask: (id: string) => void;
}

const th = "border-b border-gray-300 bg-gray-700 px-2 py-1.5 text-left text-xs font-semibold text-white whitespace-nowrap";
const td = "border-b border-gray-200 px-2 py-1 text-sm whitespace-nowrap";

function repeatLabel(task: Task): string {
  if (!task.repeat) return "";
  const r = task.repeat;
  const base = `${r.interval}${REPEAT_UNIT_LABELS[r.unit]}`;
  const wd =
    r.unit === "week" && r.weekdays?.length
      ? `(${r.weekdays.map((w) => ["日", "月", "火", "水", "木", "金", "土"][w]).join("")})`
      : "";
  return r.mode === "afterComplete" ? `完了+${base}` : `毎${base}${wd}`;
}

/** 編集開始時に入力欄へ入れる文字列 */
function editValueOf(task: Task, field: EditableField): string {
  switch (field) {
    case "date":
      return task.date ?? "";
    case "title":
      return task.title;
    case "importance":
      return task.importance;
    case "estimateMin":
      return String(task.estimateMin ?? 0);
    case "planStart":
      return (task.planStart ?? "").replace(":", "");
    case "actStart":
      return (task.actStart ?? "").replace(":", "");
    case "actEnd":
      return (task.actEnd ?? "").replace(":", "");
    case "deadline":
      return task.deadline ?? "";
    case "category":
      return task.category;
  }
}

/** 入力文字列からタスクへの変更点を作る。null なら変更なし(不正値等) */
function patchOf(task: Task, field: EditableField, raw: string): Partial<Task> | null {
  switch (field) {
    case "title": {
      const v = raw.trim();
      return v && v !== task.title ? { title: v } : null; // 空は無視
    }
    case "category":
      return { category: raw.trim() };
    case "importance":
      return { importance: raw as Importance };
    case "estimateMin":
      return { estimateMin: Math.max(0, Math.floor(Number(raw) || 0)) };
    case "date":
      return { date: raw || undefined };
    case "deadline":
      return { deadline: raw || undefined };
    case "planStart":
    case "actStart":
    case "actEnd": {
      if (raw === "") return { [field]: undefined } as Partial<Task>;
      const p = parseTimeInput(raw);
      return p ? ({ [field]: p } as Partial<Task>) : null; // 不正な時刻は変更しない
    }
  }
}

export default function TaskTable({
  tasks,
  selectedIds,
  onToggleSelect,
  onToggleWait,
  onUpdateTask,
  focusedId,
  onFocusTask,
  ...handlers
}: Props) {
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null);

  const startEdit = (id: string, field: EditableField) => {
    onFocusTask(id);
    setEditing({ id, field });
  };

  const commit = (task: Task, field: EditableField, raw: string) => {
    const patch = patchOf(task, field, raw);
    if (patch) onUpdateTask({ ...task, ...patch, updatedAt: new Date().toISOString() });
  };

  const finish = (id: string, field: EditableField, reason: FinishReason) => {
    if (reason === "exit") {
      setEditing(null);
      return;
    }
    const idx = EDIT_ORDER.indexOf(field);
    const nextIdx = reason === "next" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= EDIT_ORDER.length) setEditing(null);
    else setEditing({ id, field: EDIT_ORDER[nextIdx] });
  };

  // 使用中カテゴリ(文字順)。インライン候補に使う
  const categories = collectCategories(tasks);

  /** editableなセルを描く小ヘルパー */
  const cell = (
    task: Task,
    field: EditableField,
    type: "text" | "number" | "time" | "date" | "select",
    display: ReactNode,
    extra?: {
      tdClass?: string;
      options?: { value: string; label: string }[];
      placeholder?: string;
      renderEditor?: (api: {
        value: string;
        setValue: (v: string) => void;
        commit: (v: string, reason: FinishReason) => void;
        cancel: () => void;
      }) => ReactNode;
    }
  ) => (
    <EditableCell
      editing={editing?.id === task.id && editing.field === field}
      type={type}
      editValue={editValueOf(task, field)}
      display={display}
      options={extra?.options}
      placeholder={extra?.placeholder}
      renderEditor={extra?.renderEditor}
      tdClassName={extra?.tdClass ?? td}
      onStartEdit={() => startEdit(task.id, field)}
      onCommit={(raw) => commit(task, field, raw)}
      onFinish={(reason) => finish(task.id, field, reason)}
    />
  );

  if (tasks.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-gray-400">
        表示するタスクがありません。「N」キーまたは「+ タスク追加」で書き出しを始めましょう。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-300 shadow-sm">
      <table className="w-full border-collapse bg-white">
        <thead>
          <tr>
            <th className={th}></th>
            <th className={th}>日付</th>
            <th className={th}>区分</th>
            <th className={th}>ステータス</th>
            <th className={th}>繰返</th>
            <th className={th}>タスク名</th>
            <th className={th}>重要度</th>
            <th className={th}>見積</th>
            <th className={th}>開始予定</th>
            <th className={th}>終了予定</th>
            <th className={th}>開始</th>
            <th className={th}>終了</th>
            <th className={th}>実績</th>
            <th className={th}>残り</th>
            <th className={th}>期限</th>
            <th className={th}>カテゴリ</th>
            <th className={th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const act = actMin(t);
            const focused = t.id === focusedId;
            return (
              <tr
                key={t.id}
                data-task-id={t.id}
                onClick={() => onFocusTask(t.id)}
                // 編集不可の場所をダブルクリックすると詳細ダイアログ
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, input, select, a, textarea")) return;
                  handlers.onEdit(t);
                }}
                className={`${taskBgClass(t)} hover:brightness-95 ${
                  focused ? "outline outline-2 -outline-offset-2 outline-blue-600" : ""
                }`}
              >
                <td className={td}>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.id)}
                      onChange={() => onToggleSelect(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      title="選択(連続開始時刻の設定対象。選択した順に番号が付きます)"
                    />
                    {selectedIds.includes(t.id) && (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                        {selectedIds.indexOf(t.id) + 1}
                      </span>
                    )}
                  </span>
                </td>

                {/* 日付(インライン) */}
                {cell(t, "date", "date", t.date ? formatDateJa(t.date) : "毎日")}

                {/* 区分(仕事/個人)は編集不可 */}
                <td className={`${td} text-center`} title={t.scope === "work" ? "仕事" : "個人"}>
                  {t.scope === "work" ? "💼" : "🏠"}
                </td>

                {/* ステータス(待ちトグル) */}
                <td className={td}>
                  <button
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(derivedStatus(t))}`}
                    title={
                      t.actEnd
                        ? "クリックで待ちタスクとして複製(Wキー)"
                        : "クリックで待ちON/OFF(Wキー)"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWait(t);
                    }}
                  >
                    {DERIVED_STATUS_LABELS[derivedStatus(t)]}
                  </button>
                </td>

                {/* 繰返(編集不可・詳細で) */}
                <td className={`${td} text-xs text-gray-500`}>{repeatLabel(t)}</td>

                {/* タスク名(インライン) */}
                {cell(
                  t,
                  "title",
                  "text",
                  <span className="whitespace-normal">
                    <span className={t.actEnd ? "line-through" : ""}>
                      {t.parentId && <span className="text-gray-400">└ </span>}
                      {t.title || <span className="text-gray-300">(無題)</span>}
                    </span>
                    {t.links.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 text-blue-500 hover:underline"
                        title={url}
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗
                      </a>
                    ))}
                    {t.memos.some((m) => m) && (
                      <span
                        className="ml-1 cursor-help text-gray-400"
                        title={t.memos.filter(Boolean).join("\n")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        📝
                      </span>
                    )}
                  </span>,
                  { tdClass: `${td} max-w-xs`, placeholder: "タスク名" }
                )}

                {/* 重要度(インライン・セレクト) */}
                {cell(
                  t,
                  "importance",
                  "select",
                  <span
                    className={`inline-block w-6 rounded text-center text-xs font-bold ${importanceBadgeClass(t.importance)}`}
                  >
                    {t.importance}
                  </span>,
                  { options: ALL_IMPORTANCES.map((i) => ({ value: i, label: i })) }
                )}

                {/* 見積(インライン・数値) */}
                {cell(t, "estimateMin", "number", t.estimateMin || "", { tdClass: `${td} text-right` })}

                {/* 開始予定(インライン・4桁) */}
                {cell(t, "planStart", "time", t.planStart ?? "")}

                {/* 終了予定(計算・編集不可) */}
                <td className={`${td} text-gray-500`}>{planEnd(t) ?? ""}</td>

                {/* 開始実績/終了実績(インライン・4桁) */}
                {cell(t, "actStart", "time", t.actStart ?? "")}
                {cell(t, "actEnd", "time", t.actEnd ?? "")}

                {/* 実績/残り(計算・編集不可) */}
                <td className={`${td} text-right text-gray-500`}>{act ?? ""}</td>
                <td className={`${td} text-right text-gray-500`}>{remainMin(t) || ""}</td>

                {/* 期限(インライン) */}
                {cell(t, "deadline", "date", t.deadline ? formatDateJa(t.deadline) : "", {
                  tdClass: `${td} ${deadlineTextClass(t)}`,
                })}

                {/* カテゴリ(インライン・前方一致コンボボックス) */}
                {cell(t, "category", "text", t.category, {
                  renderEditor: (api) => (
                    <CategoryInput
                      value={api.value}
                      categories={categories}
                      onChange={api.setValue}
                      onCommit={(v) => api.commit(v, "exit")}
                      onTab={(shift, v) => api.commit(v, shift ? "prev" : "next")}
                      onCancel={api.cancel}
                      autoFocus
                      placeholder="運用業務 等"
                      className="w-full rounded border border-blue-400 bg-white px-1 py-0.5 text-sm outline-none"
                    />
                  ),
                })}

                {/* 操作 */}
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <TaskActions task={t} {...handlers} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
