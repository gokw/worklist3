// ==============================================================
// カード/リスト形式ビュー(Todoist風)
// ==============================================================
import type { Task } from "../types";
import { DERIVED_STATUS_LABELS } from "../types";
import { formatDateJa, formatMin } from "../lib/date";
import { actMin, derivedStatus, planEnd } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
import { parseLink } from "../lib/link";
import {
  deadlineTextClass,
  importanceBadgeClass,
  statusBadgeClass,
  taskBgClass,
} from "./rowStyle";

interface Props extends TaskActionHandlers {
  tasks: Task[];
  /** 選択中のタスクID(選択した順) */
  selectedIds: string[];
  /** 待ちフラグのトグル(完了タスクは待ちタスクとして複製) */
  onToggleWait: (task: Task) => void;
  /** キーボードカーソル位置のタスクID */
  focusedId: string | null;
  onFocusTask: (id: string) => void;
  /** ローカルパスのリンクをクリップボードへコピー(#45) */
  onCopyPath?: (path: string) => void;
}

export default function TaskCards({
  tasks,
  selectedIds,
  onToggleWait,
  focusedId,
  onFocusTask,
  onCopyPath,
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
          // ダブルクリックで編集(ボタン/入力/リンク上は除外)
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button, input, select, a, textarea")) return;
            handlers.onEdit(t);
          }}
          title="ダブルクリックで編集"
          className={`rounded-lg border p-3 shadow-sm ${taskBgClass(t)} ${
            t.id === focusedId
              ? "border-blue-600 ring-2 ring-blue-400"
              : selectedIds.includes(t.id)
                ? "border-blue-300"
                : "border-gray-200"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {selectedIds.includes(t.id) && (
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white"
                    title="連続時刻の設定順"
                  >
                    {selectedIds.indexOf(t.id) + 1}
                  </span>
                )}
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
                <span
                  className="text-[11px]"
                  title={t.scope === "work" ? "仕事" : "個人"}
                >
                  {t.scope === "work" ? "💼" : "🏠"}
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
                  {t.links.map((url, i) => {
                    const link = parseLink(url);
                    if (link.kind === "local") {
                      return (
                        <button
                          key={i}
                          type="button"
                          className="max-w-56 truncate text-gray-600 hover:opacity-70"
                          title={`${link.display}\n(クリックでパスをコピー→エクスプローラに貼り付け)`}
                          onClick={() => onCopyPath?.(link.value)}
                        >
                          {link.isFile ? "📄" : "📁"} {link.display}
                        </button>
                      );
                    }
                    return (
                      <a
                        key={i}
                        href={link.value}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-56 truncate text-blue-500 hover:underline"
                      >
                        🔗 {link.display}
                      </a>
                    );
                  })}
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
