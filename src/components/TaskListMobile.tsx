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
//   ・リンクとメモはタスク名の右に絵文字で並べる(#88)。行を増やさない —
//     1行1タスクが崩れると一覧を見渡せなくなる。溢れるのはタスク名の方
//   ・行の長押しで操作シート、横スワイプで日付移動(#100)。判定は lib/gesture.ts
// ==============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { DERIVED_STATUS_LABELS } from "../types";
import { formatDateJa, formatMin } from "../lib/date";
import {
  type Axis,
  LONG_PRESS_MS,
  SWIPE_COMMIT,
  decideSwipe,
  lockAxis,
  movedTooFarForLongPress,
  swipeOffset,
} from "../lib/gesture";
import { actMin, derivedStatus } from "../lib/logic";
import { linkIcon, parseLink } from "../lib/link";
import TaskActionSheet from "./TaskActionSheet";
import { statusBadgeClass, taskBgClass } from "./rowStyle";

interface Props {
  tasks: Task[];
  onStart: (task: Task) => void;
  onEnd: (task: Task) => void;
  onEdit: (task: Task) => void;
  /** メモ本文の表示(タスク名の右の📝) */
  onShowMemo: (task: Task) => void;
  /** ローカルパスのコピー(ブラウザから開けないため。#45) */
  onCopyPath: (path: string) => void;
  /** 次の日程へ延期(#100 の操作シート) */
  onPostpone: (task: Task) => void;
  /** 日付を1日ずらす(#100 のスワイプ・操作シート) */
  onMoveDate: (task: Task, mode: "prev" | "next") => void;
  /** 削除(#100 の操作シート)。undo で戻せる */
  onDelete: (task: Task) => void;
  /**
   * 読み取り専用。打刻を無効化し、ジェスチャも armed にしない(#100 §3-6)。
   * 別窓が書き手のとき(#57)と、手番を持たない端末(#91)の両方を含む。
   */
  readOnly?: boolean;
}

/** 進行中のジェスチャ。再描画を挟まず読み書きしたいので ref に置く */
interface Gesture {
  taskId: string;
  x0: number;
  y0: number;
  axis: Axis | null;
  longPressFired: boolean;
  timer: number | undefined;
}

/** 長押しの待ちを取り消す(指が動いた・向きが縦に決まった) */
function clearGestureTimer(g: Gesture): void {
  if (g.timer !== undefined) window.clearTimeout(g.timer);
  g.timer = undefined;
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
  onCopyPath,
  onPostpone,
  onMoveDate,
  onDelete,
  readOnly = false,
}: Props) {
  const gesture = useRef<Gesture | null>(null);
  /**
   * このタップをジェスチャが使い切ったか。true のとき onClick(詳細編集)を出さない。
   * スクロールやスワイプの後に編集画面が開くのを防ぐ。pointerdown ごとに戻す。
   */
  const consumed = useRef(false);
  /** スワイプ中の行と、指に追従させるずらし量 */
  const [swipe, setSwipe] = useState<{ taskId: string; dx: number } | null>(null);
  /** 長押しで開く操作シートの対象 */
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

  const clearGesture = useCallback(() => {
    if (gesture.current?.timer !== undefined) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    setSwipe(null);
  }, []);

  // 指を置いたまま一覧が消えた(表示切替・絞り込みの変更)ときに、
  // 残ったタイマーが後からシートを開かないようにする
  useEffect(() => {
    return () => {
      if (gesture.current?.timer !== undefined) window.clearTimeout(gesture.current.timer);
      gesture.current = null;
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, task: Task) => {
      consumed.current = false;
      if (readOnly) return; // 書き込めない端末ではジェスチャを持たせない(§3-6)
      // 打刻ボタンやリンクの上からでもスワイプを始められるようにする。
      // ボタンは行幅の約2割を占めるので、ここを死角にすると「効かない場所」ができる。
      // 押した扱いにしないための抑止は、各ボタン側の consumed 判定で行う。
      const g: Gesture = {
        taskId: task.id,
        x0: e.clientX,
        y0: e.clientY,
        axis: null,
        longPressFired: false,
        timer: undefined,
      };
      // 長押しは指(ペン)だけ。マウスでボタンを押したままにして menu が出ると驚く
      if (e.pointerType !== "mouse") {
        g.timer = window.setTimeout(() => {
          if (gesture.current !== g) return;
          g.longPressFired = true;
          consumed.current = true;
          setSwipe(null);
          navigator.vibrate?.(10); // 対応端末だけ。iOS では何も起きない
          setSheetTask(task);
        }, LONG_PRESS_MS);
      }
      gesture.current = g;
    },
    [readOnly]
  );

  const onPointerMove = useCallback((e: React.PointerEvent, task: Task) => {
    const g = gesture.current;
    if (!g || g.taskId !== task.id || g.longPressFired) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (movedTooFarForLongPress(dx, dy)) clearGestureTimer(g);
    if (g.axis === null) {
      const axis = lockAxis(dx, dy);
      if (!axis) return;
      g.axis = axis;
      if (axis === "vertical") {
        // ブラウザのスクロールへ譲る。このタップで編集を開かない(#97 の一覧スクロール優先)
        consumed.current = true;
        clearGestureTimer(g);
        return;
      }
      // 横と決まったら、指が行の外へ出ても追い続けられるように捕捉する
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (g.axis === "horizontal") {
      consumed.current = true;
      setSwipe({ taskId: task.id, dx: swipeOffset(dx) });
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent, task: Task) => {
      const g = gesture.current;
      clearGesture();
      if (!g || g.taskId !== task.id || g.longPressFired) return;
      if (g.axis !== "horizontal") return; // 動いていない=タップ。onClick に任せる
      const action = decideSwipe(e.clientX - g.x0);
      if (action) onMoveDate(task, action);
    },
    [clearGesture, onMoveDate]
  );

  const onPointerCancel = useCallback(() => {
    // ブラウザがスクロールを引き取ったときなど。タップとして扱ってはいけない
    consumed.current = true;
    clearGesture();
  }, [clearGesture]);

  if (tasks.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-gray-400">
        表示するタスクがありません。＋ で追加できます。
      </p>
    );
  }

  return (
    // ページ自体はスクロールしない設計(App のルートが overflow-hidden)なので、
    // 一覧が自前のスクロールコンテナを持つ。表(TaskTable)と同じ構造。
    // これが無いと画面より下のタスクへ永久に到達できない(#97。💾メニューの #95 と同根)
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
              const links = t.links.filter((l) => l.trim() !== "");
              const sw = swipe?.taskId === t.id ? swipe.dx : 0;
              const willCommit = Math.abs(sw) >= SWIPE_COMMIT;
              return (
                <li key={t.id} className="relative overflow-hidden border-b border-gray-200">
                  {/* スワイプ中に行の下から覗く行き先。しきい値を越えたら濃くして
                      「離せば実行」を示す(#100 §3-2) */}
                  {sw !== 0 && (
                    <div
                      className={`pointer-events-none absolute inset-0 flex items-center px-5 text-sm font-bold text-white ${
                        sw > 0 ? "justify-start bg-emerald-500" : "justify-end bg-amber-500"
                      } ${willCommit ? "opacity-100" : "opacity-50"}`}
                    >
                      {sw > 0 ? "→ 翌日へ" : "前日へ ←"}
                    </div>
                  )}
                  {/* 行のどこを押しても詳細編集。打刻ボタンだけは伝播を止める。
                      長押し=操作シート / 横スワイプ=日付移動(#100)。
                      touch-pan-y で縦スクロールはブラウザに任せ、横だけをここで拾う */}
                  <div
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => onPointerDown(e, t)}
                    onPointerMove={(e) => onPointerMove(e, t)}
                    onPointerUp={(e) => onPointerUp(e, t)}
                    onPointerCancel={onPointerCancel}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => {
                      if (consumed.current) return; // スワイプ・長押し・スクロールの後
                      onEdit(t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onEdit(t);
                      }
                    }}
                    style={{
                      transform: sw ? `translateX(${sw}px)` : undefined,
                      WebkitTouchCallout: "none",
                    }}
                    className={`relative flex min-h-[56px] w-full touch-pan-y select-none items-center gap-2 px-2 py-1.5 text-left ${taskBgClass(t)} ${
                      sw === 0 ? "transition-transform" : ""
                    }`}
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
                        {/* リンク(#88)。地図か・Webか・ローカルかが絵文字で分かる。
                            行タップ(詳細編集)に伝播させない */}
                        {links.map((url, i) => {
                          const link = parseLink(url);
                          const cls = "shrink-0 px-1 py-2 text-base leading-none";
                          // ローカルパスはブラウザから開けない。押したらパスをコピー(#45)
                          if (link.kind === "local") {
                            return (
                              <button
                                key={i}
                                type="button"
                                className={cls}
                                title={`${link.display}\n(タップでパスをコピー)`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (consumed.current) return;
                                  onCopyPath(link.value);
                                }}
                              >
                                {linkIcon(link)}
                              </button>
                            );
                          }
                          return (
                            <a
                              key={i}
                              href={link.value}
                              target="_blank"
                              rel="noreferrer"
                              className={cls}
                              title={link.display}
                              onClick={(e) => {
                                e.stopPropagation();
                                // スワイプの終点がリンクの上だっただけ。開かない
                                if (consumed.current) e.preventDefault();
                              }}
                            >
                              {linkIcon(link)}
                            </a>
                          );
                        })}
                        {hasMemo && (
                          <button
                            className="shrink-0 px-1 py-2 text-base leading-none"
                            title="メモを表示"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (consumed.current) return;
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
                          if (consumed.current) return; // スワイプ・長押しの終点だった
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

      {/* 長押しで開く操作シート(#100)。実行後は閉じる。取り消しはトーストの〔↩ 元に戻す〕 */}
      {sheetTask && (
        <TaskActionSheet
          task={sheetTask}
          canPostpone={!sheetTask.actEnd && !sheetTask.actStart}
          onPostpone={() => {
            onPostpone(sheetTask);
            setSheetTask(null);
          }}
          onNextDay={() => {
            onMoveDate(sheetTask, "next");
            setSheetTask(null);
          }}
          onPrevDay={() => {
            onMoveDate(sheetTask, "prev");
            setSheetTask(null);
          }}
          onDelete={() => {
            onDelete(sheetTask);
            setSheetTask(null);
          }}
          onClose={() => setSheetTask(null)}
        />
      )}
    </div>
  );
}
