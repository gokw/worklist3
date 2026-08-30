// ==============================================================
// バックアップの方針ロジックのテスト
//   保存先の抽象化により、書き込み手段から切り離してテストできるようになった部分。
//   ここが守るのは「壊れたデータを控えへ焼き付けない」「古い世代が確実に消える」の2点。
// ==============================================================
import { describe, it, expect } from "vitest";
import { expiredDailyDates, guardReason } from "./backup";
import { dailyFileDate, dailyFileName, mirrorFileName } from "./backupTargets/types";

describe("guardReason(サニティガード)", () => {
  it("比較元が無ければ判定しない(初回接続時に書けなくならないように)", () => {
    expect(guardReason(0, null)).toBe("");
    expect(guardReason(500, null)).toBe("");
  });

  it("比較元が0件なら判定しない", () => {
    expect(guardReason(100, 0)).toBe("");
  });

  it("0件になったら保留する", () => {
    expect(guardReason(0, 800)).toContain("0件");
  });

  it("50%以上かつ5件以上減ったら保留する", () => {
    expect(guardReason(399, 800)).toContain("急減");
  });

  it("ちょうど50%減は保留する(境界)", () => {
    expect(guardReason(400, 800)).toContain("急減");
  });

  it("50%未満の減少は通す", () => {
    expect(guardReason(401, 800)).toBe("");
  });

  it("件数が少ないうちは、割合が大きくても5件未満の減少なら通す", () => {
    // 6件→2件は67%減だが4件しか減っていない。日々の消化で普通に起きる
    expect(guardReason(2, 6)).toBe("");
  });

  it("5件以上かつ50%以上なら少件数でも保留する", () => {
    expect(guardReason(5, 10)).toContain("急減");
  });

  it("増えているときは通す", () => {
    expect(guardReason(900, 800)).toBe("");
  });
});

describe("expiredDailyDates(ローテーションの掃除対象)", () => {
  const today = "2026-08-30";

  it("保持期間(14日)より古い日付だけを選ぶ", () => {
    const dates = ["2026-08-30", "2026-08-17", "2026-08-16", "2026-08-01"];
    // 14日保持 = 8/17〜8/30 が残る。8/16 以前が対象
    expect(expiredDailyDates(dates, today)).toEqual(["2026-08-16", "2026-08-01"]);
  });

  it("当日ぶんは消さない", () => {
    expect(expiredDailyDates([today], today)).toEqual([]);
  });

  it("保持期間の境界(14日前)は残す", () => {
    expect(expiredDailyDates(["2026-08-17"], today)).toEqual([]);
  });

  it("未来日付(端末の時計ずれ)は消さない", () => {
    expect(expiredDailyDates(["2026-09-05"], today)).toEqual([]);
  });

  it("空でも落ちない", () => {
    expect(expiredDailyDates([], today)).toEqual([]);
  });
});

describe("ファイル名の規約", () => {
  it("従来のローカル保存先の名前を変えない(既存の控えを読み続けられる)", () => {
    expect(mirrorFileName("worklist3", false)).toBe("worklist3.json");
    expect(dailyFileName("worklist3", "2026-08-30", false)).toBe("worklist3-2026-08-30.json");
  });

  it("圧縮時は .gz が付く", () => {
    expect(mirrorFileName("worklist3", true)).toBe("worklist3.json.gz");
    expect(dailyFileName("worklist3", "2026-08-30", true)).toBe("worklist3-2026-08-30.json.gz");
  });

  it("端末名を含む接頭辞(Drive想定)でも往復する", () => {
    const name = dailyFileName("worklist3-スマホ", "2026-08-30", true);
    expect(name).toBe("worklist3-スマホ-2026-08-30.json.gz");
    expect(dailyFileDate("worklist3-スマホ", name)).toBe("2026-08-30");
  });

  it("掃除の判定が .gz にも効く(効かないと古い世代が無限に増える)", () => {
    expect(dailyFileDate("worklist3", "worklist3-2026-08-30.json")).toBe("2026-08-30");
    expect(dailyFileDate("worklist3", "worklist3-2026-08-30.json.gz")).toBe("2026-08-30");
  });

  it("規約外の名前には触らない", () => {
    for (const name of [
      "メモ.txt",
      "worklist3.json",
      "worklist3-2026-08.json",
      "worklist3-2026-08-30.json.bak",
      "other-2026-08-30.json",
      "worklist3-2026-08-30.json.gz.tmp",
    ]) {
      expect(dailyFileDate("worklist3", name)).toBeNull();
    }
  });

  it("接頭辞に正規表現の特殊文字が入っても誤爆しない", () => {
    expect(dailyFileDate("work.list", "workXlist-2026-08-30.json")).toBeNull();
    expect(dailyFileDate("work.list", "work.list-2026-08-30.json")).toBe("2026-08-30");
  });
});
