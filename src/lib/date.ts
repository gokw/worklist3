// ==============================================================
// 日付・時刻ユーティリティ
// ==============================================================

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

/** 指定日より後で、指定曜日(0=日〜6=土)に該当する直近の日付を返す */
export function nextWeekdayAfter(dateStr: string, weekdays: number[]): string {
  const d = parseDateStr(dateStr);
  for (let i = 1; i <= 7; i++) {
    d.setDate(d.getDate() + 1);
    if (weekdays.includes(d.getDay())) return toDateStr(d);
  }
  return toDateStr(d);
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
