// ==============================================================
// カード/リスト形式ビュー(Todoist風)
// ==============================================================
import type { Task } from "../types";
import { DERIVED_STATUS_LABELS } from "../types";
import { formatDateJa, formatMin } from "../lib/date";
import { actMin, derivedStatus, planEnd } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
import {
  deadlineTextClass,
  importanceBadgeClass,
  statusBadgeClass,
  taskBgClass,
} from "./rowStyle";

interface Props extends TaskActionHandlers {
  tasks: Task[];
  selectedIds: Set<string>;
  /** 待ちフラグのトグル(完了タスクは待ちタスクとして複製) */
  onToggleWait: (task: Task) => void;
  /** キーボードカーソル位置のタスクID */
  focusedId: string | null;
  onFocusTask: (id: string) => void;
}

export default function TaskCards({
  tasks,
  selectedIds,
  onToggleWait,
  focusedId,
  onFocusTask,
  ...handlers
}: Props) {
  if (tasks.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-gray-400">
        表示するタスクがありません。「N」キーまたは「+ タスク追加」で書き出しを始めましょう。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div
          key={t.id}
          data-task-id={t.id}
          onClick={() => onFocusTask(t.id)}
          className={`rounded-lg border p-3 shadow-sm ${taskBgClass(t)} ${
            t.id === focusedId
              ? "border-blue-600 ring-2 ring-blue-400"
              : selectedIds.has(t.id)
                ? "border-blue-300"
                : "border-gray-200"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-block w-6 rounded text-center text-xs font-bold ${importanceBadgeClass(t.importance)}`}
                >
                  {t.importance}
                </span>
                <span
                  className={`font-semibold ${t.actEnd ? "line-through" : "text-gray-800"}`}
                >
                  {t.parentId && <span className="text-gray-400">└ </span>}
                  {t.title}
                </span>
                <button
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(derivedStatus(t))}`}
                  title={
                    t.actEnd
                      ? "クリックで待ちタスクとして複製(Wキー)"
                      : "クリックで待ちON/OFF(Wキー)"
                  }
                  onClick={() => onToggleWait(t)}
                >
                  {DERIVED_STATUS_LABELS[derivedStatus(t)]}
                </button>
                {t.category && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">
                    {t.category}
                  </span>
                )}
                {t.repeat && <span title="繰り返しタスク">🔁</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>📅 {t.date ? formatDateJa(t.date) : "毎日"}</span>
                {t.planStart && (
                  <span>
                    🕐 {t.planStart}
                    {planEnd(t) ? `〜${planEnd(t)}` : ""}
                  </span>
                )}
                {t.estimateMin > 0 && <span>見積 {formatMin(t.estimateMin)}</span>}
                {actMin(t) !== undefined && <span>実績 {formatMin(actMin(t))}</span>}
                {t.deadline && (
                  <span className={deadlineTextClass(t)}>⏰ 期限 {formatDateJa(t.deadline)}</span>
                )}
              </div>
              {t.links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {t.links.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-56 truncate text-blue-500 hover:underline"
                    >
                      🔗 {url}
                    </a>
                  ))}
                </div>
              )}
              {t.memos.some((m) => m) && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">
                  {t.memos.filter(Boolean).join(" / ")}
                </p>
              )}
            </div>
            <div className="shrink-0">
              <TaskActions task={t} {...handlers} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
