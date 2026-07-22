// ==============================================================
// 貼り付け取込の解析(Issue #9 / #22)
// ==============================================================
import { describe, it, expect } from "vitest";
import { parseBulkText, parseRepeatCode, parseWorklistDay } from "./bulkParse";

describe("parseRepeatCode(旧worklistの rpt)", () => {
  it("rm1 = 毎月(時刻は引き継がない)", () => {
    expect(parseRepeatCode("rm1")).toEqual({
      mode: "schedule",
      unit: "month",
      interval: 1,
      copyPlanStart: false,
    });
  });

  it("Rw1 = 毎週+開始時刻コピー", () => {
    expect(parseRepeatCode("Rw1")).toEqual({
      mode: "schedule",
      unit: "week",
      interval: 1,
      copyPlanStart: true,
    });
  });

  it("rd3 = 3日ごと", () => {
    expect(parseRepeatCode("rd3")).toMatchObject({ unit: "day", interval: 3 });
  });

  it("ry2 = 2年ごと", () => {
    expect(parseRepeatCode("ry2")).toMatchObject({ unit: "year", interval: 2 });
  });

  it("数値省略は間隔1とみなす", () => {
    expect(parseRepeatCode("rw")).toMatchObject({ unit: "week", interval: 1 });
  });

  it("空や不正な記号は undefined", () => {
    expect(parseRepeatCode("")).toBeUndefined();
    expect(parseRepeatCode("x1")).toBeUndefined();
    expect(parseRepeatCode("rx1")).toBeUndefined();
    expect(parseRepeatCode("毎週")).toBeUndefined();
  });
});

describe("parseWorklistDay(day 列)", () => {
  it("「20(月)」は既定日の年月に当てはめる", () => {
    expect(parseWorklistDay("20(月)", "2025-04-01")).toBe("2025-04-20");
  });

  it("「5」のような1桁も0埋めする", () => {
    expect(parseWorklistDay("5", "2025-04-01")).toBe("2025-04-05");
  });

  it("完全な日付表記はそのまま解釈する", () => {
    expect(parseWorklistDay("2025-04-20", "2025-01-01")).toBe("2025-04-20");
  });

  it("日付にならないものは undefined", () => {
    expect(parseWorklistDay("", "2025-04-01")).toBeUndefined();
    expect(parseWorklistDay("あ", "2025-04-01")).toBeUndefined();
    expect(parseWorklistDay("40", "2025-04-01")).toBeUndefined();
  });
});

describe("parseBulkText - かんたん形式(Issue #9)", () => {
  it("タブ区切り [日付 タイトル カテゴリ 見積] を解釈する", () => {
    const rows = parseBulkText("2026-07-15\t請求書を送る\t経理\t30", "2026-07-01");
    expect(rows).toEqual([
      { date: "2026-07-15", title: "請求書を送る", category: "経理", estimateMin: 30 },
    ]);
  });

  it("日付を省略した行は既定日になる", () => {
    const rows = parseBulkText("牛乳を買う", "2026-07-01");
    expect(rows[0]).toMatchObject({ date: "2026-07-01", title: "牛乳を買う" });
  });
});

describe("parseBulkText - 旧worklist形式(Issue #22)", () => {
  const HEADER =
    "day\tst\trpt\tcontents\t時間\t開始予定\t終了予定\t\t終了\t結果\tmemo1\tmemo2\tmemo3\ttheme\tremain";
  const ROW =
    "20(月)\t\tRw1\t障害対策改善\t30 \t10:00\t10:30\t\t\t\t2025年4月21日 16:35 に送信\tC:\\path\t\t生産時間に計上できない管理業務\t30";

  it("ヘッダ付きで貼り付けても、ヘッダ行は取り込まない", () => {
    const rows = parseBulkText(`${HEADER}\n${ROW}`, "2025-04-01");
    expect(rows).toHaveLength(1);
  });

  it("各列を Task 相当のフィールドへマッピングする", () => {
    const [r] = parseBulkText(`${HEADER}\n${ROW}`, "2025-04-01");
    expect(r).toMatchObject({
      date: "2025-04-20",
      title: "障害対策改善",
      category: "生産時間に計上できない管理業務",
      estimateMin: 30,
      planStart: "10:00",
      waiting: false,
    });
    expect(r.repeat).toEqual({
      mode: "schedule",
      unit: "week",
      interval: 1,
      copyPlanStart: true,
    });
    expect(r.memos).toEqual(["2025年4月21日 16:35 に送信", "C:\\path"]);
  });

  it("st=w は待ちフラグになる", () => {
    const row =
      "21(火)\tw\t\t待ちタスク\t15\t\t\t\t\t\t\t\t\t\t";
    const [r] = parseBulkText(row, "2025-04-01");
    expect(r.waiting).toBe(true);
    expect(r.repeat).toBeUndefined();
  });

  it("終了(実績)時刻を取り込む", () => {
    const row =
      "22(水)\t\t\t完了済み\t30\t9:00\t9:30\t\t9:35\t\t\t\t\t\t";
    const [r] = parseBulkText(row, "2025-04-01");
    expect(r.actEnd).toBe("09:35");
  });
});
