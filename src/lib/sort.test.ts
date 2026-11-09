// ==============================================================
// 並び替え(compareTasks)
// ==============================================================
import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { createTask } from "./logic";
import { sortTasks } from "./sort";

const at = (createdAt: string, p: Partial<Task>): Task =>
  createTask({ date: "2026-11-09", createdAt, updatedAt: createdAt, ...p });

describe("sortTasks 作成順(#136)", () => {
  it("開始実績が同じ分の記録は、タスク名に関係なく作った順に並ぶ", () => {
    const first = at("2026-11-09T08:15:10.000Z", { title: "📍 渋谷", actStart: "17:15", actEnd: "17:15" });
    const second = at("2026-11-09T08:15:40.000Z", { title: "📍 恵比寿", actStart: "17:15", actEnd: "17:15" });
    expect(sortTasks([second, first]).map((t) => t.title)).toEqual(["📍 渋谷", "📍 恵比寿"]);
    expect(sortTasks([first, second]).map((t) => t.title)).toEqual(["📍 渋谷", "📍 恵比寿"]);
  });

  it("開始時刻が違えば、作成順より開始時刻が先", () => {
    const early = at("2026-11-09T09:00:00.000Z", { title: "b", actStart: "09:00" });
    const late = at("2026-11-09T08:00:00.000Z", { title: "a", actStart: "10:00" });
    expect(sortTasks([late, early]).map((t) => t.title)).toEqual(["b", "a"]);
  });

  it("時刻の無いタスクどうしは、これまでどおりタスク名順", () => {
    const newer = at("2026-11-09T09:00:00.000Z", { title: "あ" });
    const older = at("2026-11-09T08:00:00.000Z", { title: "い" });
    expect(sortTasks([older, newer]).map((t) => t.title)).toEqual(["あ", "い"]);
  });

  it("開始予定だけが同じタスクどうしも、タスク名順のまま", () => {
    const newer = at("2026-11-09T09:00:00.000Z", { title: "あ", planStart: "10:00" });
    const older = at("2026-11-09T08:00:00.000Z", { title: "い", planStart: "10:00" });
    expect(sortTasks([older, newer]).map((t) => t.title)).toEqual(["あ", "い"]);
  });
});
