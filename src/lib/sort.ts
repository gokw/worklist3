// ==============================================================
// 並び替え(Excel版 SortTable の優先順位を踏襲)
//   日付 → 開始実績 → 開始予定 → ステータス → 繰り返し → 見積 → タスク名
//   Excelの昇順ソートでは空白セルが最後に来るため、空値は最後に回す。
// ==============================================================
import type { Status, Task } from "../types";

const STATUS_ORDER: Record<Status, number> = {
  inProgress: 0,
  suspended: 1,
  notStarted: 2,
  waiting: 3,
  done: 4,
};

/** 空値を最後に回して比較する */
function cmpOptional(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareTasks(a: Task, b: Task): number {
  // 1. 日付(未設定=毎日のタスクは最後)
  let c = cmpOptional(a.date, b.date);
  if (c !== 0) return c;
  // 2. 開始実績
  c = cmpOptional(a.actStart, b.actStart);
  if (c !== 0) return c;
  // 3. 開始予定
  c = cmpOptional(a.planStart, b.planStart);
  if (c !== 0) return c;
  // 4. ステータス
  c = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (c !== 0) return c;
  // 5. 繰り返し(設定ありを先に)
  c = (a.repeat ? 0 : 1) - (b.repeat ? 0 : 1);
  if (c !== 0) return c;
  // 6. 見積時間
  c = a.estimateMin - b.estimateMin;
  if (c !== 0) return c;
  // 7. タスク名
  return a.title.localeCompare(b.title, "ja");
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}
