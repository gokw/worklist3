// ==============================================================
// タスク1件に対する操作ボタン群(表・カード共通)
// ==============================================================
import type { Task } from "../types";

export interface TaskActionHandlers {
  onStart: (task: Task) => void;
  onEnd: (task: Task) => void;
  onInterrupt: (task: Task) => void;
  onCopy: (task: Task) => void;
  onEdit: (task: Task) => void;
}

interface Props extends TaskActionHandlers {
  task: Task;
}

const btn =
  "rounded px-1.5 py-0.5 text-xs font-semibold border transition-colors whitespace-nowrap";

export default function TaskActions({
  task,
  onStart,
  onEnd,
  onInterrupt,
  onCopy,
  onEdit,
}: Props) {
  const running = !!task.actStart && !task.actEnd;
  const done = !!task.actEnd;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {!running && !done && (
        <button
          className={`${btn} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
          title="開始する(Sキー)"
          onClick={() => onStart(task)}
        >
          ▶ 開始
        </button>
      )}
      {running && (
        <>
          <button
            className={`${btn} border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100`}
            title="終了する(繰り返し設定があれば次回分を自動生成)"
            onClick={() => onEnd(task)}
          >
            ■ 終了
          </button>
          <button
            className={`${btn} border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100`}
            title="中断(割り込み): 消化分と残りに分割"
            onClick={() => onInterrupt(task)}
          >
            ⚡ 中断
          </button>
        </>
      )}
      <button
        className={`${btn} border-gray-300 bg-white text-gray-600 hover:bg-gray-100`}
        title="このタスクを複製(Cキー)"
        onClick={() => onCopy(task)}
      >
        ⧉ コピー
      </button>
      <button
        className={`${btn} border-gray-300 bg-white text-gray-600 hover:bg-gray-100`}
        title="編集(Enter)"
        onClick={() => onEdit(task)}
      >
        ✎
      </button>
    </span>
  );
}
