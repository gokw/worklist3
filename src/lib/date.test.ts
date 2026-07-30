// ==============================================================
// 営業日(土日祝の回避)ユーティリティ(#37 / #30)
// ==============================================================
import { describe, it, expect } from "vitest";
import { isWeekend, isHoliday, isBusinessDay, rollToBusinessDay } from "./date";

describe("isWeekend", () => {
  it("土曜・日曜を判定する", () => {
    expect(isWeekend("2026-02-21")).toBe(true); // 土
    expect(isWeekend("2026-02-22")).toBe(true); // 日
    expect(isWeekend("2026-02-20")).toBe(false); // 金
    expect(isWeekend("2026-02-23")).toBe(false); // 月(祝日だが曜日的には平日)
  });
});

describe("isHoliday(内蔵リスト)", () => {
  it("収録された祝日を判定する", () => {
    expect(isHoliday("2026-02-23")).toBe(true); // 天皇誕生日
    expect(isHoliday("2026-05-06")).toBe(true); // 振替休日
    expect(isHoliday("2026-09-22")).toBe(true); // 国民の休日
  });
  it("平日は false", () => {
    expect(isHoliday("2026-02-20")).toBe(false);
  });
  it("収録範囲外の年は祝日なし扱い(false)", () => {
    expect(isHoliday("2030-01-01")).toBe(false);
  });
});

describe("isBusinessDay", () => {
  it("平日かつ非祝日のみ true", () => {
    expect(isBusinessDay("2026-02-20")).toBe(true); // 金・平日
    expect(isBusinessDay("2026-02-21")).toBe(false); // 土
    expect(isBusinessDay("2026-02-23")).toBe(false); // 月だが天皇誕生日
  });
});

describe("rollToBusinessDay", () => {
  it("既に営業日ならそのまま", () => {
    expect(rollToBusinessDay("2026-02-20", 1)).toBe("2026-02-20");
  });
  it("前方向: 金曜の翌日(土)を渡すと月曜へ", () => {
    // 2/21(土) → 22(日) → 23(月・天皇誕生日) → 24(火)
    expect(rollToBusinessDay("2026-02-21", 1)).toBe("2026-02-24");
  });
  it("前方向: 日曜は翌営業日へ", () => {
    expect(rollToBusinessDay("2026-02-22", 1)).toBe("2026-02-24");
  });
  it("後ろ方向: 日曜は前営業日(金)へ", () => {
    // 2/22(日) → 21(土) → 20(金)
    expect(rollToBusinessDay("2026-02-22", -1)).toBe("2026-02-20");
  });
  it("連休(振替含む)をまたいで前方向へ", () => {
    // 2026 GW: 5/3(日,憲法) 5/4(月,みどり) 5/5(火,こども) 5/6(水,振替) → 5/7(木)
    expect(rollToBusinessDay("2026-05-03", 1)).toBe("2026-05-07");
  });
});
