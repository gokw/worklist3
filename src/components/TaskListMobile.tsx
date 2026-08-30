// ==============================================================
// モバイル一覧(変更仕様書_モバイル対応.md §4.2)
//   スマートフォンで「追加・打刻・今日の確認」ができることに絞った一覧。
//   表ライト(TaskTable)の作り込み — 列幅最適化・インライン編集・
//   vim風カーソル移動 — は PC のためのもので、ここへは持ち込まない。
//
//   ・1行1タスク。タスク名は折り返さず省略する
//     (カード形式が390pxで「洗濯物 / をたたむ」と縦に潰れた反省)
//   ・行に置く操作は打刻だけ。中断・延期・コピー・削除は行タップ→詳細編集から
//   ・並び順・絞り込みは表と共通(visibleTasks をそのまま受け取る)
// ==============================================================
import type { Task } from "../types";
import { DERIVED_STATUS_LABELS } from "../types";
import { formatDateJa, formatMin } from "../lib/date";
import { actMin, derivedStatus } from "../lib/logic";
import { statusBadgeClass, taskBgClass } from "./rowStyle";

interface Props {
  tasks: Task[];
  onStart: (task: Task) => void;
  onEnd: (task: Task) => void;
  onEdit: (task: Task) => void;
  /** メモ本文の表示(タスク名の右の📝) */
  onShowMemo: (task: Task) => void;
  /** 読み取り専用(別窓が書き手のとき)。打刻を無効化する。#57 */
  readOnly?: boolean;
}

/** 日付ごとの区切り(表ライトの「日付が変わる行の下に実線」に相当) */
interface DateGroup {
  date: string;
  tasks: Task[];
  estimate: number;
  actual: number;
}

/** 受け取った並び順を保ったまま、日付が変わるところで区切る */
export function groupByDate(tasks: Task[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const t of tasks) {
    const date = t.date ?? "";
    let g = groups[groups.length - 1];
    if (!g || g.date !== date) {
      g = { date, tasks: [], estimate: 0, actual: 0 };
      groups.push(g);
    }
    g.tasks.push(t);
    g.estimate += t.estimateMin;
    g.actual += actMin(t) ?? 0;
  }
  return groups;
}

/** 2行目に出す「いつ・どれだけ」。状態によって内容が変わる */
export function timeSummary(task: Task): string {
  const st = derivedStatus(task);
  const est = task.estimateMin > 0 ? `見積 ${formatMin(task.estimateMin)}` : "";
  if (st === "done") {
    const span = `${task.actStart ?? ""}〜${task.actEnd ?? ""}`;
    const act = actMin(task);
    const actText = act === undefined ? "" : `実績 ${formatMin(act)}`;
    return [span, [actText, est].filter(Boolean).join(" / ")].filter(Boolean).join("  ");
  }
  if (st === "running") {
    return [`${task.actStart ?? ""}〜`, est].filter(Boolean).join("  ");
  }
  // 未着手・待ち
  return [task.planStart ? `予定 ${task.planStart}` : "", est].filter(Boolean).join("  ");
}

export default function TaskListMobile({
  tasks,
  onStart,
  onEnd,
  onEdit,
  onShowMemo,
  readOnly = false,
}: Props) {
  if (tasks.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-gray-400">
        表示するタスクがありません。＋ で追加できます。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groupByDate(tasks).map((g) => (
        <section key={g.date || "nodate"}>
          <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-gray-300 bg-gray-50 px-1 py-1">
            <h2 className="text-sm font-semibold text-gray-700">
              {g.date ? formatDateJa(g.date) : "日付なし"}
            </h2>
            <span className="text-xs text-gray-500">
              見積 {formatMin(g.estimate)} / 実績 {formatMin(g.actual)}
            </span>
          </div>

          <ul>
            {g.tasks.map((t) => {
              const st = derivedStatus(t);
              const summary = timeSummary(t);
              const hasMemo = t.memos.some((m) => m.trim() !== "");
              return (
                <li key={t.id} className={`border-b border-gray-200 ${taskBgClass(t)}`}>
                  {/* 行のどこを押しても詳細編集。打刻ボタンだけは伝播を止める */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onEdit(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onEdit(t);
                      }
                    }}
                    className="flex min-h-[56px] w-full items-center gap-2 px-2 py-1.5 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(st)}`}
                        >
                          {DERIVED_STATUS_LABELS[st]}
                        </span>
                        {/* 折り返さない。溢れは省略し、全文は詳細編集で見る */}
                        <span className="truncate text-[15px] font-medium">{t.title}</span>
                        {hasMemo && (
                          <button
                            className="shrink-0 text-sm"
                            title="メモを表示"
                            onClick={(e) => {
                              e.stopPropagation();
                              onShowMemo(t);
                            }}
                          >
                            📝
                          </button>
                        )}
                      </div>
                      {summary && (
                        <div className="mt-0.5 truncate text-xs text-gray-600">{summary}</div>
                      )}
                    </div>

                    {/* 打刻。完了したタスクには出さない */}
                    {st !== "done" && (
                      <button
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (st === "running") onEnd(t);
                          else onStart(t);
                        }}
                        className={`flex h-11 min-w-[76px] shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          st === "running"
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-emerald-600 bg-white text-emerald-700"
                        }`}
                      >
                        {st === "running" ? "■ 終了" : "▶ 開始"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
