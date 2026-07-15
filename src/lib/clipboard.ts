// ==============================================================
// クリップボード自動判別(Excel版 UnifiedInsertTask 踏襲)
//   1) teams.microsoft.com を含むURL → Teamsタスク
//   2) 2行目が「年/月/日」形式 → Outlook予定(カレンダー)タスク
//   3) それ以外 → 通常タスク
//
// Teamsタスクのタスク名は「リンクの表示テキスト」から取る。
// Excel版 InsertTeamsLink は system シートへ2回貼り(書式付き=表示テキスト /
// テキスト形式=URL)、表示テキストを contents にしていた。これに合わせるため、
// クリップボードの text/html(リッチテキスト側)を見る。
// ==============================================================
import type { Task } from "../types";
import { createTask } from "./logic";
import { todayStr, toDateStr } from "./date";

export type ClipboardKind = "teams" | "calendar" | "plain";

export interface ParsedClipboard {
  kind: ClipboardKind;
  task: Task;
}

/** リンクの表示テキストとURL(クリップボードのHTML形式から取り出す) */
interface HtmlLink {
  text: string;
  href: string;
}

/**
 * HTML形式のクリップボードから、指定ホストを指すリンクを1件取り出す。
 * 表示テキストがURLそのもの(リンク化されただけの生URL)なら、名前として使えないので捨てる。
 */
function findHtmlLink(html: string | undefined, hostPart: string): HtmlLink | undefined {
  if (!html) return undefined;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return undefined;
  }
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!href.includes(hostPart)) continue;
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.includes(hostPart)) continue; // 表示テキストがURLなら名前にならない
    return { text, href };
  }
  return undefined;
}

/** Excel版 IsCalendarText: 「年/月/日」で始まるか */
function isCalendarText(s: string): boolean {
  return /^\d{1,4}\/\d{1,2}\/\d{1,2}/.test(s.trim());
}

/** "23/2/27" や "2026/7/11" を YYYY-MM-DD へ */
function parseSlashDate(s: string): string | undefined {
  const m = s.trim().match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return undefined;
  let y = Number(m[1]);
  if (y < 100) y += 2000; // "23" → 2023
  const d = new Date(y, Number(m[2]) - 1, Number(m[3]));
  return toDateStr(d);
}

/** "10:00" 形式 → HH:MM(ゼロ埋め) */
function normalizeTime(s: string): string | undefined {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * クリップボードの内容からタスクを1件組み立てる。
 * @param clip プレーンテキスト(text/plain)
 * @param html リッチテキスト(text/html)。あればTeamsリンクの表示テキストを名前に使う
 */
export function parseClipboardText(clip: string, html?: string): ParsedClipboard {
  const lines = clip.split(/\r\n|\r|\n/).filter((_, i, arr) => !(i === 0 && arr[0] === ""));

  // --- 1) Teamsリンク ---
  const htmlLink = findHtmlLink(html, "teams.microsoft.com");
  if (htmlLink || (clip.includes("https://") && clip.includes("teams.microsoft.com"))) {
    // URLの末尾に付きがちな > ) 」 、。 などは切り落とす
    // (Outlook本文の「ここをクリック<https://...>」対策)
    const urlMatch = clip.match(/https:\/\/[^\s<>"')」』】]*teams\.microsoft\.com[^\s<>"')」』】]*/);
    const url = htmlLink?.href || (urlMatch ? urlMatch[0] : "");
    // 名前は「リンクの表示テキスト」が最優先(Excel版 InsertTeamsLink 踏襲)。
    // 無ければURL以外の最初の行。それも無ければ既定名。
    // 区切り線や飾り(___ === --- など)だけの行は名前にならないので飛ばす
    const titleLine = lines.find(
      (l) =>
        l.trim() !== "" &&
        !l.includes("teams.microsoft.com") &&
        !/^[\s_=\-*・—―─]+$/.test(l)
    );
    return {
      kind: "teams",
      task: createTask({
        title: htmlLink?.text || titleLine?.trim() || "Teams会議",
        date: todayStr(),
        estimateMin: 0,
        links: url ? [url] : [],
      }),
    };
  }

  // --- 2) カレンダー予定(2行目が日付) 例:
  //   会議タイトル
  //   23/2/27 (月) 10:00 - 11:00
  if (lines.length >= 2 && isCalendarText(lines[1])) {
    const title = lines[0].trim();
    const parts = lines[1].trim().split(/\s+/); // [日付, (曜), 開始, -, 終了]
    const date = parseSlashDate(parts[0]);
    const start = parts.length > 2 ? normalizeTime(parts[2]) : undefined;
    const end = parts.length > 4 ? normalizeTime(parts[4]) : undefined;

    let estimate = 0;
    if (start && end) {
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const diff = toMin(end) - toMin(start);
      estimate = diff >= 0 ? diff : diff + 1440;
    }

    return {
      kind: "calendar",
      task: createTask({
        title: title || "予定",
        date: date ?? todayStr(),
        planStart: start,
        estimateMin: estimate,
      }),
    };
  }

  // --- 3) 通常タスク(改行を除去して1行のタイトルに) ---
  const title = clip.replace(/\r\n|\r|\n/g, " ").trim();
  return {
    kind: "plain",
    task: createTask({ title, date: todayStr() }),
  };
}
