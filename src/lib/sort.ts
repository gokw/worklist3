// ==============================================================
// 並び替え(Issue #11 の優先度)
//   日付 → 開始時刻 → 終了時刻 → 重要度 → 分類名 → タスク名
//   ※日付は Issue の指定には無いが、複数日ビュー(今日以降/全期間)が
//     日毎にまとまるよう先頭キーとして残している。
//   ※「開始時刻」は実績があれば実績、なければ開始予定(未開始の予定も時刻順に並ぶ)。
//   Excel同様、空値は昇順の最後に回す。
// ==============================================================
import type { Task } from "../types";
import { ALL_IMPORTANCES } from "../types";

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
  // 2. 開始時刻(実績 > 予定。HH:MM文字列は辞書順=時刻順)
  c = cmpOptional(a.actStart ?? a.planStart, b.actStart ?? b.planStart);
  if (c !== 0) return c;
  // 3. 終了時刻(実績)
  c = cmpOptional(a.actEnd, b.actEnd);
  if (c !== 0) return c;
  // 4. 重要度(S→E)
  c = ALL_IMPORTANCES.indexOf(a.importance) - ALL_IMPORTANCES.indexOf(b.importance);
  if (c !== 0) return c;
  // 5. 分類名(カテゴリ。空は最後)
  if (a.category !== b.category) {
    if (!a.category) return 1;
    if (!b.category) return -1;
    c = a.category.localeCompare(b.category, "ja");
    if (c !== 0) return c;
  }
  // 6. タスク名
  return a.title.localeCompare(b.title, "ja");
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}
