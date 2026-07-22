// ==============================================================
// 貼り付けテキスト → 複数タスクの解析(Issue #9 / #22)
//   1行1件。2通りの形式を自動判別する。
//
//   (A) かんたん形式(Issue #9):
//       タブ区切りなら [日付][タイトル][カテゴリ][見積] の順(Excel貼り付け向き)。
//       タブが無ければ「日付 タイトル」(先頭が日付として解釈できる場合)。
//       先頭が日付でなければ、その行全体をタイトルとして日付は既定日にする。
//
//   (B) 旧worklist形式(Issue #22):
//       元のExcel/worklistをそのまま貼り付けたときの15列フォーマット。
//         day  st  rpt  contents  時間  開始予定  終了予定  (空)  終了  結果  memo1  memo2  memo3  theme  remain
//       タブ区切りで列数が多い(=8列以上)行があれば、この形式とみなす。
//       ヘッダ行("day"や"contents"などの見出し)は自動でスキップする。
// ==============================================================
import type { RepeatConfig } from "../types";
import { parseFlexibleDate, parseTimeInput } from "./date";

export interface ParsedRow {
  date: string;
  title: string;
  category: string;
  estimateMin: number;
  /** 開始予定時刻 HH:MM(旧worklist形式のみ) */
  planStart?: string;
  /** 終了実績 HH:MM(旧worklist形式のみ) */
  actEnd?: string;
  /** 待ちフラグ(旧worklist形式 st="w") */
  waiting?: boolean;
  /** 繰り返し設定(旧worklist形式 rpt) */
  repeat?: RepeatConfig;
  /** メモ最大3件(旧worklist形式) */
  memos?: string[];
}

/**
 * 旧worklist形式の rpt(繰り返し)記号を RepeatConfig に変換する(Issue #22)。
 *   1文字目 r=通常 / R=開始予定時刻も次回にコピー
 *   2文字目 d=日 / w=週 / m=月 / y=年
 *   3文字目 数値(間隔。省略時は1)
 *   例) "rm1"=毎月 / "Rw1"=毎週+開始時刻コピー / "rd3"=3日ごと
 * 解釈できなければ undefined。
 */
export function parseRepeatCode(code: string): RepeatConfig | undefined {
  const m = code.trim().match(/^([rR])([dwmy])(\d*)$/);
  if (!m) return undefined;
  const unit = { d: "day", w: "week", m: "month", y: "year" }[m[2]] as
    | RepeatConfig["unit"]
    | undefined;
  if (!unit) return undefined;
  const interval = m[3] ? parseInt(m[3], 10) : 1;
  return {
    mode: "schedule", // 旧worklistの繰り返しは元の日付基準(定期)
    unit,
    interval: interval > 0 ? interval : 1,
    copyPlanStart: m[1] === "R",
  };
}

/**
 * 旧worklistの day 列を YYYY-MM-DD に正規化する(Issue #22)。
 *   "20(月)" / "20" のような「日だけ」の表記は、既定日の年月に当てはめる。
 *   "2025-04-20" のような完全な日付表記はそのまま解釈する。
 * 解釈できなければ undefined。
 */
export function parseWorklistDay(cell: string, defaultDate: string): string | undefined {
  const t = cell.trim();
  if (!t) return undefined;
  // 完全な日付表記ならそのまま
  const full = parseFlexibleDate(t);
  if (full) return full;
  // 先頭の数字を「日」として扱い、既定日の年月に当てはめる
  const m = t.match(/^(\d{1,2})/);
  if (!m) return undefined;
  const day = parseInt(m[1], 10);
  if (day < 1 || day > 31) return undefined;
  const [y, mo] = defaultDate.split("-");
  return `${y}-${mo}-${String(day).padStart(2, "0")}`;
}

// ---- かんたん形式(A) ----

function parseSimpleLine(line: string, defaultDate: string): ParsedRow | null {
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

// ---- 旧worklist形式(B) ----

/** その行が旧worklistのヘッダ行(見出し)かどうか */
function isWorklistHeader(cols: string[]): boolean {
  const joined = cols.slice(0, 4).join("\t").toLowerCase();
  return (
    joined.includes("day") ||
    joined.includes("contents") ||
    cols[2]?.trim().toLowerCase() === "rpt"
  );
}

// 列インデックス: 0=day 1=st 2=rpt 3=contents 4=時間 5=開始予定 6=終了予定
//                7=(空) 8=終了 9=結果 10=memo1 11=memo2 12=memo3 13=theme 14=remain
function parseWorklistLine(line: string, defaultDate: string): ParsedRow | null {
  const cols = line.split("\t").map((c) => c.trim());
  if (isWorklistHeader(cols)) return null;

  const title = (cols[3] ?? "").trim();
  if (!title) return null; // タイトルの無い行は無視(区切り行など)

  const est = parseInt(cols[4] ?? "", 10);
  const memos = [cols[9], cols[10], cols[11], cols[12]]
    .map((m) => (m ?? "").trim())
    .filter((m) => m !== "")
    .slice(0, 3);

  return {
    date: parseWorklistDay(cols[0] ?? "", defaultDate) ?? defaultDate,
    title,
    category: (cols[13] ?? "").trim(),
    estimateMin: Number.isFinite(est) && est > 0 ? est : 0,
    planStart: parseTimeInput(cols[5] ?? ""),
    actEnd: parseTimeInput(cols[8] ?? ""),
    waiting: (cols[1] ?? "").trim().toLowerCase() === "w",
    repeat: parseRepeatCode(cols[2] ?? ""),
    memos: memos.length > 0 ? memos : undefined,
  };
}

/** 旧worklist形式か判定(タブ区切りで列数が多い行が1つでもあれば) */
function looksLikeWorklist(lines: string[]): boolean {
  return lines.some((l) => l.split("\t").length >= 8);
}

export function parseBulkText(text: string, defaultDate: string): ParsedRow[] {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  const parseLine = looksLikeWorklist(lines) ? parseWorklistLine : parseSimpleLine;
  return lines
    .map((l) => parseLine(l, defaultDate))
    .filter((r): r is ParsedRow => r !== null);
}
