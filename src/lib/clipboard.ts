// ==============================================================
// クリップボード自動判別(Excel版 UnifiedInsertTask 踏襲)
//   1) teams.microsoft.com を含むURL → Teamsタスク
//   2) 2行目が「年/月/日」形式 → Outlook予定(カレンダー)タスク
//   3) それ以外 → 通常タスク
// ==============================================================
import type { Task } from "../types";
import { createTask } from "./logic";
import { todayStr, toDateStr } from "./date";

export type ClipboardKind = "teams" | "calendar" | "plain";

export interface ParsedClipboard {
  kind: ClipboardKind;
  task: Task;
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

export function parseClipboardText(clip: string): ParsedClipboard {
  const lines = clip.split(/\r\n|\r|\n/).filter((_, i, arr) => !(i === 0 && arr[0] === ""));

  // --- 1) Teamsリンク ---
  if (clip.includes("https://") && clip.includes("teams.microsoft.com")) {
    const urlMatch = clip.match(/https:\/\/\S*teams\.microsoft\.com\S*/);
    const url = urlMatch ? urlMatch[0] : "";
    // URL以外の最初の行をタイトルにする
    const titleLine = lines.find(
      (l) => l.trim() !== "" && !l.includes("teams.microsoft.com")
    );
    return {
      kind: "teams",
      task: createTask({
        title: titleLine?.trim() || "Teams会議",
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
