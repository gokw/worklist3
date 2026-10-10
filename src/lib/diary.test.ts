import { describe, expect, it } from "vitest";
import { createTask } from "./logic";
import { mapsUrl } from "./geo";
import {
  buildDiary,
  diaryLineCount,
  diaryToHtml,
  diaryToText,
  formatDiaryDate,
} from "./diary";

const MAP = mapsUrl(35.501677, 139.6577566);

/** ここにいる記録(#86 の handleRecordLocation と同じ形) */
function location(title: string, date: string, time: string) {
  return createTask({
    title,
    date,
    actStart: time,
    actEnd: time,
    memos: ["35.501677, 139.657757 (±12m)", "", ""],
    links: [MAP],
  });
}

describe("formatDiaryDate", () => {
  it("年月日と曜日", () => {
    expect(formatDiaryDate("2026-10-10")).toBe("2026年10月10日(土)");
    expect(formatDiaryDate("2026-01-05")).toBe("2026年1月5日(月)");
  });
});

describe("buildDiary / diaryToText", () => {
  it("Issue #128 の例のとおりに出る", () => {
    const days = buildDiary([
      createTask({ title: "朝の散歩", date: "2026-10-10", actStart: "09:00", actEnd: "09:30" }),
      location("📍 おかげでのんびりできた", "2026-10-10", "17:15"),
    ]);
    expect(diaryToText(days)).toBe(
      [
        "2026年10月10日(土)",
        "09:00頃 朝の散歩(30分)",
        `17:15頃 [📍](${MAP}) おかげでのんびりできた`,
      ].join("\n")
    );
  });

  it("開始実績の無いものは出さない", () => {
    const days = buildDiary([
      createTask({ title: "まだ", date: "2026-10-10" }),
      createTask({ title: "やった", date: "2026-10-10", actStart: "10:00", actEnd: "10:10" }),
    ]);
    expect(diaryLineCount(days)).toBe(1);
    expect(diaryToText(days)).not.toContain("まだ");
  });

  it("日付ごとに見出しを立て、日付順・開始時刻順に並べる(元の並びに依らない)", () => {
    const days = buildDiary([
      createTask({ title: "B", date: "2026-10-11", actStart: "08:00", actEnd: "08:05" }),
      createTask({ title: "A2", date: "2026-10-10", actStart: "13:00", actEnd: "13:20" }),
      createTask({ title: "A1", date: "2026-10-10", actStart: "09:00", actEnd: "10:30" }),
    ]);
    expect(diaryToText(days)).toBe(
      [
        "2026年10月10日(土)",
        "09:00頃 A1(90分)",
        "13:00頃 A2(20分)",
        "",
        "2026年10月11日(日)",
        "08:00頃 B(5分)",
      ].join("\n")
    );
  });

  it("同じ分の記録は作った順(画面の並びに依らない)", () => {
    const first = location("📍 ホーム着", "2026-10-06", "08:43");
    const second = location("📍 列に並ぶ", "2026-10-06", "08:43");
    first.createdAt = "2026-10-05T23:43:05.120Z";
    second.createdAt = "2026-10-05T23:43:41.900Z";
    const text = diaryToText(buildDiary([second, first]));
    expect(text.indexOf("ホーム着")).toBeLessThan(text.indexOf("列に並ぶ"));
  });

  it("実行中(未終了)と0分は時間を付けない", () => {
    const days = buildDiary([
      createTask({ title: "実行中", date: "2026-10-10", actStart: "09:00" }),
      createTask({ title: "一瞬", date: "2026-10-10", actStart: "10:00", actEnd: "10:00" }),
    ]);
    expect(diaryToText(days)).toBe(
      ["2026年10月10日(土)", "09:00頃 実行中", "10:00頃 一瞬"].join("\n")
    );
  });

  it("名前を付けなかった場所の記録は 📍 のリンクだけ", () => {
    const days = buildDiary([location("📍 35.501677, 139.657757", "2026-10-10", "17:15")]);
    expect(diaryToText(days)).toBe(`2026年10月10日(土)\n17:15頃 [📍](${MAP})`);
  });

  it("📍 で始まってもマップのリンクが無ければ普通のタスク扱い", () => {
    const days = buildDiary([
      createTask({ title: "📍 手で付けた", date: "2026-10-10", actStart: "11:00", actEnd: "11:15" }),
    ]);
    expect(diaryToText(days)).toBe("2026年10月10日(土)\n11:00頃 📍 手で付けた(15分)");
  });

  it("0件なら空", () => {
    expect(buildDiary([])).toEqual([]);
    expect(diaryToText([])).toBe("");
  });
});

describe("diaryToHtml", () => {
  it("場所は <a> になり、行は <div>、日の間は空行", () => {
    const days = buildDiary([
      location("📍 公園", "2026-10-10", "17:15"),
      createTask({ title: "翌日", date: "2026-10-11", actStart: "08:00", actEnd: "08:30" }),
    ]);
    expect(diaryToHtml(days)).toBe(
      "<div>2026年10月10日(土)</div>" +
        `<div>17:15頃 <a href="${MAP.replace(/&/g, "&amp;")}">📍</a> 公園</div>` +
        "<div><br></div>" +
        "<div>2026年10月11日(日)</div>" +
        "<div>08:00頃 翌日(30分)</div>"
    );
  });

  it("タイトルの記号はエスケープする", () => {
    const days = buildDiary([
      createTask({ title: "<b>&\"x\"", date: "2026-10-10", actStart: "09:00", actEnd: "09:10" }),
    ]);
    expect(diaryToHtml(days)).toContain("&lt;b&gt;&amp;&quot;x&quot;");
  });
});
