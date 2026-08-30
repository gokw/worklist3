// ==============================================================
// 実行中タスクのバナー(Issue #68)
//   いま開始しているタスクを、ツールバー直下に常時表示する。
//     ・タスク名 / 終了予定時刻 / 残り時間(1秒ごとにカウントダウン)
//     ・終了予定を過ぎたら赤くして「超過」表示
//     ・終了予定を過ぎた瞬間にブラウザ通知を1回だけ発火(許可済みのとき)
//   目的は「いま何をしているか」「いつまでに終えるか」を見失わず、集中できること。
// ==============================================================
import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "../types";
import { hhmmToMin, parseDateStr } from "../lib/date";
import { runningPlanEnd } from "../lib/logic";

interface Props {
  /** 実行中(開始実績あり・終了実績なし)のタスク一覧。表示フィルタに関わらず全件から渡す */
  runningTasks: Task[];
  /** バナーの「終了」ボタン。対象タスクを終了フローへ渡す */
  onEnd: (task: Task) => void;
  /** タスク名クリックで、その行へジャンプ(フォーカス)する */
  onFocus: (task: Task) => void;
  /** モバイル(狭い画面)。1行に詰め、通知ボタンはアイコンだけにする */
  compact?: boolean;
}

/** 開始実績(task.date + actStart)からの終了予定時刻(ms)。出せなければ null */
function endTimestamp(task: Task): number | null {
  const startMin = hhmmToMin(task.actStart);
  if (startMin === undefined || !task.estimateMin) return null;
  const base = parseDateStr(task.date ?? "").getTime();
  if (Number.isNaN(base)) return null;
  return base + startMin * 60000 + task.estimateMin * 60000;
}

/** 残りミリ秒 → "M:SS" / "H:MM:SS"。超過分は呼び出し側で符号を付ける */
function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export default function RunningBanner({
  runningTasks,
  onEnd,
  onFocus,
  compact = false,
}: Props) {
  // 1秒ごとに現在時刻を更新してカウントダウンを回す
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (runningTasks.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [runningTasks.length]);

  // 通知の許可状態(ボタン表示の出し分け用)
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  // すでに「超過通知」を出したタスクID(重複通知を防ぐ)
  const notifiedRef = useRef<Set<string>>(new Set());

  // 終了予定が近い順に並べ、先頭を主表示にする
  const items = useMemo(() => {
    return runningTasks
      .map((task) => {
        const end = endTimestamp(task);
        return { task, end, planEndHHMM: runningPlanEnd(task) };
      })
      .sort((a, b) => {
        // 終了予定ありを先に、その中で早い順。見積なしは末尾
        if (a.end === null && b.end === null) return 0;
        if (a.end === null) return 1;
        if (b.end === null) return -1;
        return a.end - b.end;
      });
  }, [runningTasks]);

  // 終了予定を過ぎた瞬間に通知を1回だけ。実行中でなくなったIDは記録から落とす
  useEffect(() => {
    const alive = new Set(runningTasks.map((t) => t.id));
    for (const id of notifiedRef.current) {
      if (!alive.has(id)) notifiedRef.current.delete(id);
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const { task, end, planEndHHMM } of items) {
      if (end === null) continue;
      if (now >= end && !notifiedRef.current.has(task.id)) {
        notifiedRef.current.add(task.id);
        try {
          new Notification("⏰ 終了予定の時刻です", {
            body: `${task.title}(終了予定 ${planEndHHMM})`,
            tag: `worklist3-${task.id}`,
          });
        } catch {
          // 通知生成に失敗しても本体機能は続行する
        }
      }
    }
  }, [now, items, runningTasks]);

  // タブのタイトルにも主タスクの残り時間を出す(バックグラウンドでも見えるように)
  useEffect(() => {
    const base = "worklist3";
    const head = items[0];
    if (!head) {
      document.title = base;
      return;
    }
    if (head.end !== null) {
      const diff = head.end - now;
      const label = diff >= 0 ? `残${formatClock(diff)}` : `超過${formatClock(-diff)}`;
      document.title = `${label} ${head.task.title} — ${base}`;
    } else {
      document.title = `▶ ${head.task.title} — ${base}`;
    }
    return () => {
      document.title = base;
    };
  }, [items, now]);

  const requestPermission = () => {
    if (typeof Notification === "undefined") return;
    void Notification.requestPermission().then(setNotifyPerm);
  };

  if (runningTasks.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-1 border-b border-emerald-200 bg-emerald-50 py-1.5 ${
        compact ? "px-2" : "px-4"
      }`}
    >
      {items.map(({ task, end, planEndHHMM }) => {
        const diff = end === null ? null : end - now;
        const overdue = diff !== null && diff < 0;
        return (
          <div
            key={task.id}
            className={`flex items-center gap-x-2 gap-y-1 text-sm ${
              compact ? "flex-nowrap" : "flex-wrap gap-x-3"
            } ${overdue ? "text-red-800" : "text-emerald-900"}`}
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-1 font-semibold">
              <span aria-hidden>{overdue ? "⏰" : "▶"}</span>
              <button
                type="button"
                onClick={() => onFocus(task)}
                className="max-w-full truncate underline-offset-2 hover:underline"
                title="この行へ移動"
              >
                {task.title || "(無題)"}
              </button>
            </span>

            {!compact &&
              (planEndHHMM ? (
                <span className="tabular-nums">
                  終了予定 <span className="font-semibold">{planEndHHMM}</span>
                </span>
              ) : (
                <span className="text-emerald-700/70">見積なし</span>
              ))}

            {diff !== null && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                  overdue ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                }`}
                title={overdue ? "終了予定を過ぎています" : "残り時間"}
              >
                {overdue ? `超過 +${formatClock(-diff)}` : `残り ${formatClock(diff)}`}
              </span>
            )}

            <button
              type="button"
              onClick={() => onEnd(task)}
              className="shrink-0 rounded bg-emerald-700 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-emerald-800"
              title="このタスクを終了する"
            >
              ■ 終了
            </button>
          </div>
        );
      })}

      {/* 通知が未許可なら、有効化ボタンを1つだけ出す(終了予定の通知を受け取るため) */}
      {notifyPerm === "default" && (
        <div className="text-xs text-emerald-800">
          <button
            type="button"
            onClick={requestPermission}
            className="rounded border border-emerald-400 px-2 py-0.5 font-semibold hover:bg-emerald-100"
          >
            {compact ? "🔔 通知を許可" : "🔔 終了時刻の通知を有効化"}
          </button>
        </div>
      )}
    </div>
  );
}
