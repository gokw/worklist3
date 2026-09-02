// ==============================================================
// タッチジェスチャの判定(変更仕様書_スマホのタスク操作.md §3-4)
//   モバイル一覧の「長押し」「横スワイプ」を、縦スクロールと喧嘩させずに拾うための判定。
//   DOM に触らない純粋関数だけを置き、状態機械の本体(TaskListMobile)から使う。
//
//   ここが守るのは1点。**縦に動かしたときは必ずブラウザのスクロールへ譲る。**
//   一覧は #97 で自前のスクロールコンテナになったので、ここで横を拾いすぎると
//   スクロールできない状態に逆戻りする。
// ==============================================================

/** 長押しと判定するまでの時間(ms)。Android / iOS の標準的な長押しに合わせる */
export const LONG_PRESS_MS = 500;

/** これ以上動いたら長押しは取り消す(指のぶれは許す) */
export const LONG_PRESS_SLOP = 10;

/**
 * 縦横どちらのジェスチャかを決める距離。
 * 長押しの許容(10px)より大きくして、「先に長押しが取り消されてから向きが決まる」順にする。
 */
export const AXIS_LOCK_SLOP = 12;

/** スワイプを確定する横移動量(px)。390px 幅で約18% */
export const SWIPE_COMMIT = 72;

/** スワイプの向きと操作の対応(§3-5)。右=翌日(未来)/左=前日(過去) */
export const SWIPE_ACTION = { right: "next", left: "prev" } as const;

export type SwipeAction = (typeof SWIPE_ACTION)[keyof typeof SWIPE_ACTION];
export type Axis = "horizontal" | "vertical";

/**
 * 指の動きが縦横どちらかを決める。まだ決められないうちは null。
 *
 * 一度決めたら、その回は切り替えない(呼び出し側が保持する)。
 * 途中で切り替えると、スクロールの最中に行が横へ飛ぶ。
 */
export function lockAxis(dx: number, dy: number, slop = AXIS_LOCK_SLOP): Axis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  // 同値は縦に倒す。迷ったらスクロールを優先する(操作を奪わない方が害が小さい)
  return ax > ay ? "horizontal" : "vertical";
}

/** 横移動が確定量に達していれば、対応する操作を返す。届いていなければ null(元へ戻す) */
export function decideSwipe(dx: number, commit = SWIPE_COMMIT): SwipeAction | null {
  if (dx >= commit) return SWIPE_ACTION.right;
  if (dx <= -commit) return SWIPE_ACTION.left;
  return null;
}

/** 長押しを取り消すほど動いたか */
export function movedTooFarForLongPress(dx: number, dy: number, slop = LONG_PRESS_SLOP): boolean {
  return Math.hypot(dx, dy) > slop;
}

/**
 * スワイプ中に行をどれだけずらして見せるか。
 * 確定量の少し先で頭打ちにして、指を動かし続けても行が画面外へ出ないようにする。
 */
export function swipeOffset(dx: number, commit = SWIPE_COMMIT): number {
  const max = commit * 1.5;
  return Math.max(-max, Math.min(max, dx));
}
