// ==============================================================
// タスクのライフサイクルロジック(延期など)
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  computeRepeatNextDate,
  createTask,
  postponeTask,
  runningPlanEnd,
  runningRemainMin,
} from "./logic";

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

describe("computeRepeatNextDate(予定日基準の固定日・名目日で回す。#66)", () => {
  it("毎月15日: 次回は名目の15日。土日でも丸めない", () => {
    // 2026-02-15 基準 → 3/15(日)。予定日基準は丸めないので 3/15 のまま
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 15, copyPlanStart: false },
        "2026-02-15"
      )
    ).toBe("2026-03-15");
  });

  it("毎月5日: 基準日が該当日を過ぎていても翌々月へ飛ばない(#66)", () => {
    // 5日指定で基準日が 8/6(5日を1日過ぎ)。従来は 10/5(翌々月)になっていた。
    // 予定日基準は基準日が属するサイクル(8/5)を起点にするので次は 9/5。
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 5, copyPlanStart: false },
        "2026-08-06"
      )
    ).toBe("2026-09-05");
  });

  it("毎月5日: 該当日より前の基準日は当サイクルの該当日へ(9/1→9/5)", () => {
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 5, copyPlanStart: false },
        "2026-09-01"
      )
    ).toBe("2026-09-05");
  });

  it("毎月1日: 名目日で回すので前月へ越境した基準日でもループしない", () => {
    // 10/30 を基準にしても次回は 11/1(名目日)。丸めないので以降 12/1…と進む。
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 1, copyPlanStart: false },
        "2026-10-30"
      )
    ).toBe("2026-11-01");
  });

  it("毎年5月3日: 基準日が属するサイクルの翌回=当年5/3。土日でも丸めない", () => {
    // 2026-01-01 基準 → 直近の 5/3 は 2025-05-03 → +1年 = 2026-05-03(日)。丸めない
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "year", interval: 1, month: 5, dayOfMonth: 3, copyPlanStart: false },
        "2026-01-01"
      )
    ).toBe("2026-05-03");
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

  it("末日クランプ: 毎月31日は31日の無い月では末日へ(丸めない)", () => {
    // 2026-01-31 基準 → 2月 → 2026-02-28(末日=土)。予定日基準は丸めないのでそのまま
    expect(
      computeRepeatNextDate(
        { mode: "schedule", unit: "month", interval: 1, dayOfMonth: 31, copyPlanStart: false },
        "2026-01-31"
      )
    ).toBe("2026-02-28");
  });

  it("完了トリガーの固定日は従来どおり完了日以降の名目日+前営業日丸め", () => {
    // afterComplete は #30 の挙動を維持: 2026-02-15 起点 → 3/15(日) → 前営業日 3/13(金)
    expect(
      computeRepeatNextDate(
        { mode: "afterComplete", unit: "month", interval: 1, dayOfMonth: 15, copyPlanStart: false },
        "2026-02-15"
      )
    ).toBe("2026-03-13");
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

describe("runningPlanEnd(実行中タスクの終了予定時刻。#68)", () => {
  it("開始実績 + 見積 を返す", () => {
    const t = createTask({ actStart: "09:00", estimateMin: 90 });
    expect(runningPlanEnd(t)).toBe("10:30");
  });

  it("日跨ぎは24h折り返しで表示する", () => {
    const t = createTask({ actStart: "23:30", estimateMin: 60 });
    expect(runningPlanEnd(t)).toBe("00:30");
  });

  it("開始実績が無ければ undefined", () => {
    expect(runningPlanEnd(createTask({ estimateMin: 30 }))).toBeUndefined();
  });

  it("見積が0なら undefined(終了時刻を出せない)", () => {
    expect(runningPlanEnd(createTask({ actStart: "09:00", estimateMin: 0 }))).toBeUndefined();
  });
});

describe("runningRemainMin(実行中タスクの残り分。#68)", () => {
  it("経過ぶんを引いた残りを返す(09:00開始/見積60/現在09:20 → 残40)", () => {
    const t = createTask({ actStart: "09:00", estimateMin: 60 });
    expect(runningRemainMin(t, 9 * 60 + 20)).toBe(40);
  });

  it("終了予定を過ぎていれば負(超過)を返す", () => {
    const t = createTask({ actStart: "09:00", estimateMin: 30 });
    expect(runningRemainMin(t, 9 * 60 + 50)).toBe(-20);
  });

  it("日跨ぎ(23:30開始/現在00:10)は折り返して経過40分と数える", () => {
    const t = createTask({ actStart: "23:30", estimateMin: 60 });
    expect(runningRemainMin(t, 10)).toBe(20); // 経過40 → 残20
  });

  it("開始実績が無ければ undefined", () => {
    expect(runningRemainMin(createTask({ estimateMin: 30 }), 600)).toBeUndefined();
  });
});
