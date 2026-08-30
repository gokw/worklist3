// ==============================================================
// モバイル一覧の純粋ロジック(日付の区切りと、2行目の要約)のテスト
// ==============================================================
import { describe, it, expect } from "vitest";
import { groupByDate, timeSummary } from "./TaskListMobile";
import { migrateTask } from "../lib/storage";
import type { Task } from "../types";

const t = (o: Partial<Task>): Task => migrateTask({ id: o.title ?? "x", title: "task", ...o });

describe("groupByDate", () => {
  it("受け取った並び順を変えずに日付で区切る", () => {
    const g = groupByDate([
      t({ title: "a", date: "2026-08-30" }),
      t({ title: "b", date: "2026-08-30" }),
      t({ title: "c", date: "2026-09-01" }),
    ]);
    expect(g.map((x) => x.date)).toEqual(["2026-08-30", "2026-09-01"]);
    expect(g[0].tasks.map((x) => x.title)).toEqual(["a", "b"]);
  });

  it("同じ日付が離れて現れたら別の区切りになる(並び順を勝手に変えない)", () => {
    const g = groupByDate([
      t({ title: "a", date: "2026-08-30" }),
      t({ title: "b", date: "2026-09-01" }),
      t({ title: "c", date: "2026-08-30" }),
    ]);
    expect(g).toHaveLength(3);
  });

  it("日付ごとに見積と実績を合計する", () => {
    const g = groupByDate([
      t({ title: "a", date: "2026-08-30", estimateMin: 30, actStart: "09:00", actEnd: "09:20" }),
      t({ title: "b", date: "2026-08-30", estimateMin: 15 }),
    ]);
    expect(g[0].estimate).toBe(45);
    expect(g[0].actual).toBe(20);
  });

  it("日付なしのタスクもまとめられる", () => {
    const g = groupByDate([t({ title: "a" })]);
    expect(g).toHaveLength(1);
    expect(g[0].date).toBe("");
  });

  it("空でも落ちない", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("timeSummary(2行目の「いつ・どれだけ」)", () => {
  it("未着手で開始予定があれば予定と見積を出す", () => {
    expect(timeSummary(t({ planStart: "07:30", estimateMin: 5 }))).toBe("予定 07:30  見積 5m");
  });

  it("未着手で開始予定が無ければ見積だけ", () => {
    expect(timeSummary(t({ estimateMin: 20 }))).toBe("見積 20m");
  });

  it("見積0・予定なしなら空(行を無駄に高くしない)", () => {
    expect(timeSummary(t({}))).toBe("");
  });

  it("進行中は開始時刻を出す", () => {
    expect(timeSummary(t({ actStart: "08:10", estimateMin: 20 }))).toBe("08:10〜  見積 20m");
  });

  it("完了は実績の時間帯と実績分・見積を出す", () => {
    const s = timeSummary(t({ actStart: "07:32", actEnd: "07:36", estimateMin: 5 }));
    expect(s).toContain("07:32〜07:36");
    expect(s).toContain("実績 4m");
    expect(s).toContain("見積 5m");
  });

  it("待ちタスクは未着手と同じ扱い(打刻できる状態のまま)", () => {
    expect(timeSummary(t({ waiting: true, estimateMin: 10 }))).toBe("見積 10m");
  });
});
