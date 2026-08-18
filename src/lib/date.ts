// ==============================================================
// 日付・時刻ユーティリティ
// ==============================================================
import { HOLIDAY_SET } from "./holidays";

/** 今日の日付を YYYY-MM-DD で返す */
export function todayStr(): string {
  return toDateStr(new Date());
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * いろいろな日付表記を YYYY-MM-DD に正規化(貼り付け取込用。Issue #9)。
 *   2026-07-15 / 2026/7/15 / 26/7/15 / 7/15(今年) に対応。不正なら undefined。
 */
export function parseFlexibleDate(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const build = (y: number, mo: number, d: number): string | undefined =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31
      ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : undefined;

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return build(2000 + +m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return build(new Date().getFullYear(), +m[1], +m[2]);
  return undefined;
}

/** 現在時刻を HH:MM で返す */
export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "HH:MM" → 分。不正なら undefined */
export function hhmmToMin(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * ユーザーの手入力を HH:MM に正規化する。不正なら undefined。
 *   "0930" / "930" → "09:30"、"9:30" / "09:30" → "09:30"
 */
export function parseTimeInput(s: string): string | undefined {
  const t = s.trim();
  if (t === "") return undefined;

  // コロン区切り(H:MM / HH:MM)
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h < 24 && min < 60
      ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
      : undefined;
  }

  // 数字のみ3〜4桁(HMM / HHMM)。3桁は先頭にゼロを補う
  m = t.match(/^(\d{3,4})$/);
  if (m) {
    const digits = m[1].padStart(4, "0");
    const h = Number(digits.slice(0, 2));
    const min = Number(digits.slice(2));
    return h < 24 && min < 60 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : undefined;
  }

  return undefined;
}

/** 分 → "HH:MM"(24時間を超えたら折り返す) */
export function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 日付に日/週/月/年を加算 */
export function addToDate(
  dateStr: string,
  unit: "day" | "week" | "month" | "year",
  n: number
): string {
  const d = parseDateStr(dateStr);
  switch (unit) {
    case "day":
      d.setDate(d.getDate() + n);
      break;
    case "week":
      d.setDate(d.getDate() + n * 7);
      break;
    case "month":
      d.setMonth(d.getMonth() + n);
      break;
    case "year":
      d.setFullYear(d.getFullYear() + n);
      break;
  }
  return toDateStr(d);
}

// ---------- 営業日(土日祝の回避)。#37 / #30 ----------

/** 土曜(6)・日曜(0)か */
export function isWeekend(dateStr: string): boolean {
  const day = parseDateStr(dateStr).getDay();
  return day === 0 || day === 6;
}

/** 内蔵リストの祝日か(収録範囲外の年は常に false = 祝日なし扱い) */
export function isHoliday(dateStr: string): boolean {
  return HOLIDAY_SET.has(dateStr);
}

/** 営業日(平日かつ非祝日)か */
export function isBusinessDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

/**
 * その日が休日(土日祝)なら、dir 方向(+1=未来 / -1=過去)へ営業日になるまでずらす。
 * 既に営業日ならそのまま返す。
 * 祝日データ不整合などで見つからないときの保険として上限(31日)を設け、
 * 超えたら丸めずに元日を返す(サイレント・フォールバック。無限ループ防止)。
 */
export function rollToBusinessDay(dateStr: string, dir: 1 | -1 = 1): string {
  let cur = dateStr;
  for (let i = 0; i < 31; i++) {
    if (isBusinessDay(cur)) return cur;
    cur = addToDate(cur, "day", dir);
  }
  return dateStr;
}

/** 指定日より後で、指定曜日(0=日〜6=土)に該当する直近の日付を返す */
export function nextWeekdayAfter(dateStr: string, weekdays: number[]): string {
  const d = parseDateStr(dateStr);
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1);
    if (weekdays.includes(d.getDay())) return toDateStr(d);
  }
  return toDateStr(d);
}

/**
 * 指定曜日群の「次の該当日」。ただし土日祝ならさらに次の該当日へ進める(#30)。
 * 単一曜日(例: 木)なら祝日のとき翌週の同曜日に、複数曜日ならその群の次の営業該当日に。
 */
export function nextBusinessWeekday(dateStr: string, weekdays: number[]): string {
  let d = nextWeekdayAfter(dateStr, weekdays);
  for (let i = 0; i < 10; i++) {
    if (isBusinessDay(d)) return d;
    d = nextWeekdayAfter(d, weekdays);
  }
  return d; // フォールバック(通常ここには来ない)
}

// ---------- 固定日(毎月X日 / 毎年X月X日)の名目日計算。#30 ----------

/** その年月(month0 = 0〜11)の日数 */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** base 以上で最初に「その月の dayOfMonth 日(末日クランプ)」になる日 = 名目の当月 */
function dayOfMonthOnOrAfter(base: string, dayOfMonth: number): Date {
  const b = parseDateStr(base);
  for (let i = 0; i <= 31; i++) {
    const c = new Date(b.getFullYear(), b.getMonth(), b.getDate() + i);
    const eff = Math.min(dayOfMonth, daysInMonth(c.getFullYear(), c.getMonth()));
    if (c.getDate() === eff) return c;
  }
  return b;
}

/** base 以下で最後に「その月の dayOfMonth 日(末日クランプ)」になる日 = base が属するサイクルの当月 */
function dayOfMonthOnOrBefore(base: string, dayOfMonth: number): Date {
  const b = parseDateStr(base);
  for (let i = 0; i <= 31; i++) {
    const c = new Date(b.getFullYear(), b.getMonth(), b.getDate() - i);
    const eff = Math.min(dayOfMonth, daysInMonth(c.getFullYear(), c.getMonth()));
    if (c.getDate() === eff) return c;
  }
  return b;
}

/**
 * 毎月 dayOfMonth 日の、interval ヶ月後の名目日(丸め前)。
 * 実日付(丸め済みのことがある)ではなく名目日から数えるのでドリフトしない(#30 セクションE)。
 * anchorBefore=true のときは base が属するサイクルの当月(基準日以下の直近の該当日)を起点にする(#66)。
 *   これにより、基準日が該当日を過ぎていても(例: 5日指定で 8/6)翌々月へ飛ばない。
 */
export function monthlyNominalDate(
  base: string,
  interval: number,
  dayOfMonth: number,
  anchorBefore = false
): string {
  const cur = anchorBefore
    ? dayOfMonthOnOrBefore(base, dayOfMonth)
    : dayOfMonthOnOrAfter(base, dayOfMonth);
  const totalMonth = cur.getMonth() + interval;
  const y = cur.getFullYear() + Math.floor(totalMonth / 12);
  const m0 = ((totalMonth % 12) + 12) % 12;
  const day = Math.min(dayOfMonth, daysInMonth(y, m0));
  return toDateStr(new Date(y, m0, day));
}

/** base 以上で最初に (month 月, dayOfMonth 日) になる日 = 名目の当年 */
function monthDayOnOrAfter(base: string, month: number, dayOfMonth: number): Date {
  const b = parseDateStr(base);
  const m0 = month - 1;
  for (let y = b.getFullYear(); y <= b.getFullYear() + 1; y++) {
    const day = Math.min(dayOfMonth, daysInMonth(y, m0));
    const cand = new Date(y, m0, day);
    if (toDateStr(cand) >= base) return cand;
  }
  return b;
}

/** base 以下で最後に (month 月, dayOfMonth 日) になる日 = base が属するサイクルの当年 */
function monthDayOnOrBefore(base: string, month: number, dayOfMonth: number): Date {
  const b = parseDateStr(base);
  const m0 = month - 1;
  for (let y = b.getFullYear(); y >= b.getFullYear() - 1; y--) {
    const day = Math.min(dayOfMonth, daysInMonth(y, m0));
    const cand = new Date(y, m0, day);
    if (toDateStr(cand) <= base) return cand;
  }
  return b;
}

/**
 * 毎年 month 月 dayOfMonth 日の、interval 年後の名目日(丸め前)。
 * anchorBefore=true のときは base が属するサイクルの当年(基準日以下の直近の該当日)を起点にする(#66)。
 */
export function yearlyNominalDate(
  base: string,
  interval: number,
  month: number,
  dayOfMonth: number,
  anchorBefore = false
): string {
  const cur = anchorBefore
    ? monthDayOnOrBefore(base, month, dayOfMonth)
    : monthDayOnOrAfter(base, month, dayOfMonth);
  const y = cur.getFullYear() + interval;
  const m0 = month - 1;
  const day = Math.min(dayOfMonth, daysInMonth(y, m0));
  return toDateStr(new Date(y, m0, day));
}

/** YYYY-MM-DD を「M/D(曜)」形式で表示 */
export function formatDateJa(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

/** 分を「1h30m」のような表示にする */
export function formatMin(min: number | undefined): string {
  if (min === undefined || Number.isNaN(min)) return "";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
