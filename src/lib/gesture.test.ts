// ==============================================================
// ジェスチャ判定のテスト(#100)
//   守るのは「縦に動かしたらスクロールへ譲る」「中途半端な指の動きで操作しない」の2点。
//   ここが崩れると、一覧がスクロールできなくなる(#97 の再発)か、誤操作が起きる。
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  AXIS_LOCK_SLOP,
  SWIPE_COMMIT,
  decideSwipe,
  lockAxis,
  movedTooFarForLongPress,
  swipeOffset,
} from "./gesture";

describe("lockAxis(縦横の決定)", () => {
  it("わずかな動きでは決めない(指を置いただけで向きを決めつけない)", () => {
    expect(lockAxis(0, 0)).toBeNull();
    expect(lockAxis(11, 11)).toBeNull();
  });

  it("横優勢なら横", () => {
    expect(lockAxis(20, 3)).toBe("horizontal");
    expect(lockAxis(-20, 3)).toBe("horizontal");
  });

  it("縦優勢なら縦(スクロールへ譲る)", () => {
    expect(lockAxis(3, 20)).toBe("vertical");
    expect(lockAxis(3, -20)).toBe("vertical");
  });

  it("斜め45度は縦に倒す(迷ったらスクロールを優先する)", () => {
    expect(lockAxis(20, 20)).toBe("vertical");
  });

  it("判定距離に達した時点で決める(境界)", () => {
    expect(lockAxis(AXIS_LOCK_SLOP - 1, 0)).toBeNull();
    expect(lockAxis(AXIS_LOCK_SLOP, 0)).toBe("horizontal");
  });

  it("縦に大きく動いていれば、横が判定距離未満でも縦と決まる", () => {
    // 一覧を速く縦スクロールする場面。ここで null のままだと横に取られる余地が残る
    expect(lockAxis(5, 40)).toBe("vertical");
  });
});

describe("decideSwipe(スワイプの確定)", () => {
  it("右へ十分動かせば翌日", () => {
    expect(decideSwipe(100)).toBe("next");
  });

  it("左へ十分動かせば前日", () => {
    expect(decideSwipe(-100)).toBe("prev");
  });

  it("届かなければ何もしない(元へ戻す)", () => {
    expect(decideSwipe(50)).toBeNull();
    expect(decideSwipe(-50)).toBeNull();
    expect(decideSwipe(0)).toBeNull();
  });

  it("確定量ちょうどで実行する(境界)", () => {
    expect(decideSwipe(SWIPE_COMMIT)).toBe("next");
    expect(decideSwipe(SWIPE_COMMIT - 1)).toBeNull();
    expect(decideSwipe(-SWIPE_COMMIT)).toBe("prev");
    expect(decideSwipe(-(SWIPE_COMMIT - 1))).toBeNull();
  });
});

describe("movedTooFarForLongPress(長押しの取り消し)", () => {
  it("指のぶれ程度なら取り消さない", () => {
    expect(movedTooFarForLongPress(5, 5)).toBe(false);
  });

  it("はっきり動いたら取り消す(スクロールやスワイプの始まり)", () => {
    expect(movedTooFarForLongPress(0, 30)).toBe(true);
    expect(movedTooFarForLongPress(30, 0)).toBe(true);
  });

  it("斜めの合成距離で判定する(縦横それぞれは小さくても動いていれば取り消す)", () => {
    // 8,8 は各軸では 10 未満だが、実際には約11px 動いている
    expect(movedTooFarForLongPress(8, 8)).toBe(true);
  });
});

describe("swipeOffset(見た目のずらし量)", () => {
  it("指の動きに追従する", () => {
    expect(swipeOffset(40)).toBe(40);
    expect(swipeOffset(-40)).toBe(-40);
  });

  it("動かし続けても頭打ちになる(行が画面外へ出ない)", () => {
    const max = SWIPE_COMMIT * 1.5;
    expect(swipeOffset(1000)).toBe(max);
    expect(swipeOffset(-1000)).toBe(-max);
  });
});
