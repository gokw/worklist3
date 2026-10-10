// ==============================================================
// 日記用のまとめ出力(Issue #128)
//   表示中のタスクを、日記へそのまま貼れる文章にする。
//
//     2026年10月10日(土)
//     09:00頃 朝の散歩(30分)
//     17:15頃 [📍](https://www.google.com/maps/...) おかげでのんびりできた
//
//   ・出すのは開始実績のあるものだけ(日記は「やったこと」なので)
//   ・日付ごとに見出しを立て、日の間は空行。1日でも複数日でも同じ処理
//   ・各日の中は開始時刻順、同じ分なら作った順(画面の並びには依存しない)
//   ・ここにいる記録(#86)は 📍 をマップへのリンクにする
//
//   クリップボードには2形式で入れる。
//     text/html  … UpNote などリッチテキストのエディタ用。<a> がそのままリンクになる
//     text/plain … Markdown([📍](url))。Markdown を解するアプリ・生成AI用
//   UpNote は貼り付け時に Markdown 記法を解釈しないので、HTML 側が要る。
// ==============================================================
import type { Task } from "../types";
import { actMin } from "./logic";
import { parseDateStr } from "./date";
import { PIN } from "./geo";

/** 1行分。テキストと HTML の両方をここから組み立てる */
export interface DiaryLine {
  /** 開始実績 HH:MM */
  time: string;
  /** 本文(場所の記録なら 📍 を除いた名前。名前が無ければ空) */
  text: string;
  /** 場所の記録ならマップのURL */
  mapUrl?: string;
  /** 実績(分)。0 や未終了なら undefined */
  min?: number;
}

export interface DiaryDay {
  /** YYYY-MM-DD */
  date: string;
  lines: DiaryLine[];
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** YYYY-MM-DD → 「2026年10月10日(土)」 */
export function formatDiaryDate(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

/** Google マップのURLか(geo.ts の mapsUrl が作る形。手で貼った maps.app.goo.gl も含める) */
function isMapUrl(url: string): boolean {
  return /^https:\/\/(www\.google\.[^/]+\/maps|maps\.google\.[^/]+|maps\.app\.goo\.gl)\//.test(url);
}

/** 座標だけのタイトル(名前を付けずに記録したもの)。#86 の resolveTitle が作る形 */
const COORDS_ONLY = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

/**
 * ここにいる記録なら、マップURLと本文を返す。
 * 目印は「タイトルが 📍 で始まり、リンクにマップのURLがある」こと。
 * 座標は既にリンクに入っているので、座標だけのタイトルは本文を空にする。
 */
function locationOf(t: Task): { mapUrl: string; text: string } | undefined {
  if (!t.title.startsWith(PIN)) return undefined;
  const mapUrl = t.links.find(isMapUrl);
  if (!mapUrl) return undefined;
  const body = t.title.slice(PIN.length).trim();
  return { mapUrl, text: COORDS_ONLY.test(body) ? "" : body };
}

/** 日記に載せる中身を組み立てる(書式に依らない部分) */
export function buildDiary(tasks: Task[]): DiaryDay[] {
  const byDate = new Map<string, { t: Task; i: number }[]>();
  tasks.forEach((t, i) => {
    if (!t.actStart || !t.date) return;
    const list = byDate.get(t.date) ?? [];
    list.push({ t, i });
    byDate.set(t.date, list);
  });
  return [...byDate.keys()].sort().map((date) => ({
    date,
    lines: byDate
      .get(date)!
      // 開始実績は分までなので、同じ分の記録は作った時刻(ミリ秒まである)で並べる。
      // ここにいる記録を続けて付けたとき、記録した順に出るように。それも同じなら元の並び
      .sort(
        (a, b) =>
          a.t.actStart!.localeCompare(b.t.actStart!) ||
          a.t.createdAt.localeCompare(b.t.createdAt) ||
          a.i - b.i
      )
      .map(({ t }) => {
        const loc = locationOf(t);
        const min = actMin(t);
        return {
          time: t.actStart!,
          text: loc ? loc.text : t.title,
          ...(loc ? { mapUrl: loc.mapUrl } : {}),
          ...(min ? { min } : {}),
        };
      }),
  }));
}

/** 何行(タスク何件)出るか。0件ならコピーしない判断に使う */
export function diaryLineCount(days: DiaryDay[]): number {
  return days.reduce((n, d) => n + d.lines.length, 0);
}

/** プレーンテキスト(Markdown)。場所は [📍](url) */
export function diaryToText(days: DiaryDay[]): string {
  return days
    .map((d) =>
      [
        formatDiaryDate(d.date),
        ...d.lines.map((l) => {
          const head = l.mapUrl ? `[${PIN}](${l.mapUrl})` : "";
          const body = [head, l.text].filter(Boolean).join(" ");
          return `${l.time}頃 ${body}${l.min ? `(${l.min}分)` : ""}`;
        }),
      ].join("\n")
    )
    .join("\n\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML。リッチテキストのエディタへ貼るとリンクになる。
 * 1行を1つの <div> にする(エディタ側で段落として扱われる)。日の間の空行は <div><br></div>。
 */
export function diaryToHtml(days: DiaryDay[]): string {
  const div = (inner: string) => `<div>${inner}</div>`;
  return days
    .map((d) =>
      [
        div(escapeHtml(formatDiaryDate(d.date))),
        ...d.lines.map((l) => {
          const head = l.mapUrl ? `<a href="${escapeHtml(l.mapUrl)}">${PIN}</a>` : "";
          const body = [head, escapeHtml(l.text)].filter(Boolean).join(" ");
          return div(`${l.time}頃 ${body}${l.min ? `(${l.min}分)` : ""}`);
        }),
      ].join("")
    )
    .join(div("<br>"));
}
