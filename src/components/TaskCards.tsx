// ==============================================================
// カード/リスト形式ビュー(Todoist風)
// ==============================================================
import type { Task } from "../types";
import { STATUS_LABELS } from "../types";
import { formatDateJa, formatMin } from "../lib/date";
import { actMin, planEnd } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
import { deadlineTextClass, importanceBadgeClass, taskBgClass } from "./rowStyle";

interface Props extends TaskActionHandlers {
  tasks: Task[];
}

export default function TaskCards({ tasks, ...handlers }: Props) {
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
          className={`rounded-lg border border-gray-200 p-3 shadow-sm ${taskBgClass(t)}`}
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
                  className={`font-semibold ${t.status === "done" ? "line-through" : "text-gray-800"}`}
                >
                  {t.parentId && <span className="text-gray-400">└ </span>}
                  {t.title}
                </span>
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-600">
                  {STATUS_LABELS[t.status]}
                </span>
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
