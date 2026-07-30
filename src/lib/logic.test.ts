// ==============================================================
// タスクのライフサイクルロジック(延期など)
// ==============================================================
import { describe, it, expect } from "vitest";
import { createTask, postponeTask } from "./logic";

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
    expect(postponeTask(t).date > "2026-05-01").toBe(true);
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
