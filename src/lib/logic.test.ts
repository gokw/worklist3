// ==============================================================
// タスクのライフサイクルロジック(延期など)
// ==============================================================
import { describe, it, expect } from "vitest";
import { computeRepeatNextDate, createTask, postponeTask } from "./logic";

describe("postponeTask(繰り返しなし。#37)", () => {
  it("金曜のタスクは翌営業日(月)へ。ただし月が祝日なら次の営業日へ", () => {
    // 2026-02-20(金) → +1=21(土) → 休日回避 → 24(火。23月は天皇誕生日)
    const t = createTask({ title: "A", date: "2026-02-20" });
    expect(postponeTask(t).date).toBe("2026-02-24");
  });

  it("平日のタスクは翌日(平日)へ", () => {
    // 2026-02-24(火) → 25(水)
    const t = createTask({ title: "A", date: "2026-02-24" });
    expect(postponeTask(t).date).toBe("2026-02-25");
  });

  it("延期すると実績・待ちはクリアされる", () => {
    const t = createTask({
      title: "A",
      date: "2026-02-24",
      actStart: "09:00",
      actEnd: "10:00",
      waiting: true,
    });
    const moved = postponeTask(t);
    expect(moved.actStart).toBeUndefined();
    expect(moved.actEnd).toBeUndefined();
    expect(moved.waiting).toBe(false);
  });

  it("延期の結果は必ず元の日付より後(同日に戻らない)", () => {
    const t = createTask({ title: "A", date: "2026-05-01" }); // 金
    expect(postponeTask(t).date! > "2026-05-01").toBe(true);
  });
});

describe("postponeTask(繰り返しあり)", () => {
  it("曜日指定の繰り返しは次の該当曜日へ", () => {
    // 毎週木曜。2026-02-24(火)基準 → 次の木曜 2026-02-26
    const t = createTask({
      title: "A",
      date: "2026-02-24",
      repeat: { mode: "schedule", unit: "week", interval: 1, weekdays: [4], copyPlanStart: false },
    });
    expect(postponeTask(t).date).toBe("2026-02-26");
  });
});

describe("computeRepeatNextDate(固定日・休日回避。#30)", () => {
  it("毎月15日: 次回15日が日曜なら前営業日(金)へ", () => {
    // 2026-02-15 基準 → 3/15(日) → 前営業日 3/13(金)
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 15, copyPlanStart: false },
        "2026-02-15"
      )
    ).toBe("2026-03-13");
  });

  it("毎月1日: 丸め済みの実日付を基準にしてもドリフトしない(名目日から計算)", () => {
    // 2026-11-01(日)は前営業日 10/30(金)に丸まる。その 10/30 を基準にしても
    // 次回は 12/1(火)= 名目日基準。素朴計算だと 11/30 になり誤り。
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 1, copyPlanStart: false },
        "2026-10-30"
      )
    ).toBe("2026-12-01");
  });

  it("毎年5月3日: 次回が祝日(憲法記念日)+連休なら前営業日へ", () => {
    // 2026-01-01 基準 → 当年 5/3 → 翌年 2027-05-03(月・憲法記念日)
    // → 5/2(日)→ 5/1(土)→ 4/30(金)
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "year", interval: 1, month: 5, dayOfMonth: 3, copyPlanStart: false },
        "2026-01-01"
      )
    ).toBe("2027-04-30");
  });

  it("毎週木曜: 次の木曜が祝日なら翌週の木曜へ(金へ丸めない)", () => {
    // 2025-12-25(木)基準 → 次の木 1/1(元日)→ 翌週の木 2026-01-08
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "week", interval: 1, weekdays: [4], copyPlanStart: false },
        "2025-12-25"
      )
    ).toBe("2026-01-08");
  });

  it("末日クランプ: 毎月31日は31日の無い月では末日へ", () => {
    // 2026-01-31 基準 → 2月 → 2026-02-28(末日)。土日祝でなければそのまま
    // 2/28(土)なので前営業日 2/27(金)
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 31, copyPlanStart: false },
        "2026-01-31"
      )
    ).toBe("2026-02-27");
  });

  it("周期(N日ごと・dayOfMonth無し)は休日回避しない", () => {
    // 3日ごと: 2026-02-19 → +3 = 2/22(日)のまま(回避しない)
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "day", interval: 3, copyPlanStart: false },
        "2026-02-19"
      )
    ).toBe("2026-02-22");
  });
});
