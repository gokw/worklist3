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
