// ==============================================================
// タスク1件に対する操作ボタン群(表・カード共通)
//   compact=true(表ライト用)ではアイコンのみの極小ボタンにする
// ==============================================================
import type { Task } from "../types";

export interface TaskActionHandlers {
  onStart: (task: Task) => void;
  onEnd: (task: Task) => void;
  onInterrupt: (task: Task) => void;
  onCopy: (task: Task) => void;
  onPostpone: (task: Task) => void;
  onEdit: (task: Task) => void;
}

interface Props extends TaskActionHandlers {
  task: Task;
  /** 表ライト用: アイコンのみの極小ボタン */
  compact?: boolean;
}

const btn =
  "rounded px-1.5 py-0.5 text-xs font-semibold border transition-colors whitespace-nowrap";
const btnCompact =
  "rounded px-0.5 leading-none text-[13px] border border-transparent transition-colors whitespace-nowrap";

export default function TaskActions({
  task,
  compact = false,
  onStart,
  onEnd,
  onInterrupt,
  onCopy,
  onPostpone,
  onEdit,
}: Props) {
  const running = !!task.actStart && !task.actEnd;
  const done = !!task.actEnd;
  const base = compact ? btnCompact : btn;
  const label = (icon: string, text: string) => (compact ? icon : `${icon} ${text}`);

  return (
    <span className={`inline-flex flex-wrap items-center ${compact ? "gap-0" : "gap-1"}`}>
      {!running && !done && (
        <button
          className={`${base} ${
            compact
              ? "text-green-600 hover:bg-green-100"
              : "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
          }`}
          title="開始する(Sキー)"
          onClick={() => onStart(task)}
        >
          {label("▶", "開始")}
        </button>
      )}
      {running && (
        <>
          <button
            className={`${base} ${
              compact
                ? "text-blue-600 hover:bg-blue-100"
                : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
            title="終了する(Eキー。繰り返し設定があれば次回分を自動生成)"
            onClick={() => onEnd(task)}
          >
            {label("■", "終了")}
          </button>
          <button
            className={`${base} ${
              compact
                ? "text-orange-500 hover:bg-orange-100"
                : "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
            }`}
            title="中断・割り込み(Iキー): 消化分と残りに分割"
            onClick={() => onInterrupt(task)}
          >
            {label("⚡", "中断")}
          </button>
        </>
      )}
      {task.repeat && !done && (
        <button
          className={`${base} ${
            compact
              ? "text-purple-500 hover:bg-purple-100"
              : "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
          }`}
          title="完了にせず次の日程へ延期(Pキー)"
          onClick={() => onPostpone(task)}
        >
          {label("⏭", "次へ")}
        </button>
      )}
      <button
        className={`${base} ${
          compact
            ? "text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
        }`}
        title="このタスクを複製(Cキー)"
        onClick={() => onCopy(task)}
      >
        {label("⧉", "コピー")}
      </button>
      <button
        className={`${base} ${
          compact
            ? "text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
        }`}
        title="詳細編集(Enter)"
        onClick={() => onEdit(task)}
      >
        ✎
      </button>
    </span>
  );
}
