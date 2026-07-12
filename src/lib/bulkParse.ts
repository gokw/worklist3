// ==============================================================
// 貼り付けテキスト → 複数タスクの解析(Issue #9)
//   1行1件。タブ区切りなら [日付][タイトル][カテゴリ][見積] の順(Excel貼り付け向き)。
//   タブが無ければ「日付 タイトル」(先頭が日付として解釈できる場合)。
//   先頭が日付でなければ、その行全体をタイトルとして日付は既定日にする。
// ==============================================================
import { parseFlexibleDate } from "./date";

export interface ParsedRow {
  date: string;
  title: string;
  category: string;
  estimateMin: number;
}

function parseLine(line: string, defaultDate: string): ParsedRow | null {
  let cols: string[];
  if (line.includes("\t")) {
    cols = line.split("\t").map((c) => c.trim());
  } else {
    const trimmed = line.trim();
    const m = trimmed.match(/^(\S+)\s+([\s\S]+)$/);
    // 先頭トークンが日付なら「日付 タイトル」、そうでなければ全体を1列
    cols = m && parseFlexibleDate(m[1]) ? [m[1], m[2]] : [trimmed];
  }

  const d0 = parseFlexibleDate(cols[0] ?? "");
  let date: string;
  let title: string;
  let category: string;
  let estStr: string;
  if (d0) {
    date = d0;
    title = cols[1] ?? "";
    category = cols[2] ?? "";
    estStr = cols[3] ?? "";
  } else {
    date = defaultDate;
    title = cols[0] ?? "";
    category = cols[1] ?? "";
    estStr = cols[2] ?? "";
  }

  title = title.trim();
  if (!title) return null; // タイトルの無い行(空行や日付のみ)は無視

  const est = parseInt(estStr, 10);
  return {
    date,
    title,
    category: category.trim(),
    estimateMin: Number.isFinite(est) && est > 0 ? est : 0,
  };
}

export function parseBulkText(text: string, defaultDate: string): ParsedRow[] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => parseLine(l, defaultDate))
    .filter((r): r is ParsedRow => r !== null);
}
