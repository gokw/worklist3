import { describe, expect, it } from "vitest";
import { parseStartupAction } from "./urlParams";

// 起動時の操作(#105)。ブックマークから直接「ここにいる」記録を開くための入口。
describe("parseStartupAction", () => {
  it("action=here を読む", () => {
    expect(parseStartupAction("?action=here")).toBe("here");
    expect(parseStartupAction("?mode=personal&action=here")).toBe("here");
  });

  it("指定が無ければ undefined", () => {
    expect(parseStartupAction("")).toBeUndefined();
    expect(parseStartupAction("?mode=personal")).toBeUndefined();
  });

  it("知らない値は無視する(勝手に何かを開かない)", () => {
    expect(parseStartupAction("?action=")).toBeUndefined();
    expect(parseStartupAction("?action=delete")).toBeUndefined();
    expect(parseStartupAction("?action=HERE")).toBeUndefined();
  });
});
