// ==============================================================
// 表形式ビュー(Excel版 worklist の列構成を踏襲)
// ==============================================================
import type { Task } from "../types";
import { DERIVED_STATUS_LABELS, REPEAT_UNIT_LABELS } from "../types";
import { formatDateJa } from "../lib/date";
import { actMin, derivedStatus, planEnd, remainMin } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
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
  onToggleSelect: (id: string) => void;
  /** 待ちフラグのトグル(完了タスクは待ちタスクとして複製) */
  onToggleWait: (task: Task) => void;
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

export default function TaskTable({
  tasks,
  selectedIds,
  onToggleSelect,
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
                // ダブルクリックで編集(ボタン/入力/リンク上は除外)
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, input, select, a, textarea")) return;
                  handlers.onEdit(t);
                }}
                title="ダブルクリックで編集"
                className={`${taskBgClass(t)} hover:brightness-95 cursor-default ${
                  focused ? "outline outline-2 -outline-offset-2 outline-blue-600" : ""
                }`}
              >
                <td className={td}>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.id)}
                      onChange={() => onToggleSelect(t.id)}
                      title="選択(連続開始時刻の設定対象。選択した順に番号が付きます)"
                    />
                    {selectedIds.includes(t.id) && (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                        {selectedIds.indexOf(t.id) + 1}
                      </span>
                    )}
                  </span>
                </td>
                <td className={td}>{t.date ? formatDateJa(t.date) : "毎日"}</td>
                <td className={`${td} text-center`} title={t.scope === "work" ? "仕事" : "個人"}>
                  {t.scope === "work" ? "💼" : "🏠"}
                </td>
                <td className={td}>
                  <button
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(derivedStatus(t))}`}
                    title={
                      t.actEnd
                        ? "クリックで待ちタスクとして複製(Wキー)"
                        : "クリックで待ちON/OFF(Wキー)"
                    }
                    onClick={() => onToggleWait(t)}
                  >
                    {DERIVED_STATUS_LABELS[derivedStatus(t)]}
                  </button>
                </td>
                <td className={`${td} text-xs text-gray-500`}>{repeatLabel(t)}</td>
                <td className={`${td} max-w-xs whitespace-normal`}>
                  <span className={t.actEnd ? "line-through" : ""}>
                    {t.parentId && <span className="text-gray-400">└ </span>}
                    {t.title}
                  </span>
                  {t.links.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 text-blue-500 hover:underline"
                      title={url}
                    >
                      🔗
                    </a>
                  ))}
                  {t.memos.some((m) => m) && (
                    <span className="ml-1 cursor-help text-gray-400" title={t.memos.filter(Boolean).join("\n")}>
                      📝
                    </span>
                  )}
                </td>
                <td className={td}>
                  <span
                    className={`inline-block w-6 rounded text-center text-xs font-bold ${importanceBadgeClass(t.importance)}`}
                  >
                    {t.importance}
                  </span>
                </td>
                <td className={`${td} text-right`}>{t.estimateMin || ""}</td>
                <td className={td}>{t.planStart ?? ""}</td>
                <td className={`${td} text-gray-500`}>{planEnd(t) ?? ""}</td>
                <td className={td}>{t.actStart ?? ""}</td>
                <td className={td}>{t.actEnd ?? ""}</td>
                <td className={`${td} text-right text-gray-500`}>{act ?? ""}</td>
                <td className={`${td} text-right text-gray-500`}>{remainMin(t) || ""}</td>
                <td className={`${td} ${deadlineTextClass(t)}`}>
                  {t.deadline ? formatDateJa(t.deadline) : ""}
                </td>
                <td className={td}>{t.category}</td>
                <td className={td}>
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
