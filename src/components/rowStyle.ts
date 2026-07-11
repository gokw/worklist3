// ==============================================================
// 行・カードの色分けルール(表とカードで共通)
//   優先度: 完了(グレー) > 期限切れ(赤) > 期限当日(黄) > 進行中(緑) > 中断中(橙)
// ==============================================================
import type { Task } from "../types";
import { isDueToday, isOverdue } from "../lib/logic";

export function taskBgClass(task: Task): string {
  if (task.status === "done") return "bg-gray-100 text-gray-400";
  if (isOverdue(task)) return "bg-red-100";
  if (isDueToday(task)) return "bg-yellow-100";
  if (task.status === "inProgress") return "bg-green-100";
  if (task.status === "suspended") return "bg-orange-50";
  if (task.status === "waiting") return "bg-purple-50";
  return "bg-white";
}

export function importanceBadgeClass(imp: Task["importance"]): string {
  switch (imp) {
    case "S":
      return "bg-red-600 text-white";
    case "A":
      return "bg-orange-500 text-white";
    case "B":
      return "bg-amber-400 text-white";
    case "C":
      return "bg-blue-500 text-white";
    case "D":
      return "bg-gray-400 text-white";
    case "E":
      return "bg-gray-200 text-gray-500";
  }
}

export function deadlineTextClass(task: Task): string {
  if (isOverdue(task)) return "font-bold text-red-600";
  if (isDueToday(task)) return "font-bold text-yellow-700";
  return "text-gray-600";
}
