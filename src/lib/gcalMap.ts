// ==============================================================
// Googleカレンダー連携: 純粋ロジック(ネットワーク・認証に依存しない)
//   - taskToEvent      : Task → カレンダーイベント本体(件名・開始・終了だけ)
//   - syncTasksToCalendar : 選択タスクを1件ずつ upsert するバッチ処理
//   実際のHTTP送信・認証は CalendarClient(下のインターフェース)に委ね、
//   ここはモックを差し込めば単体テストできる形にしてある。
// ==============================================================
import type { Task } from "../types";
import { hhmmToMin, minToHHMM, addToDate } from "./date";

/** カレンダーは Asia/Tokyo 固定(このアプリは日本時間前提) */
const TIME_ZONE = "Asia/Tokyo";
/** 見積が未設定/0のときの既定の所要時間 */
const DEFAULT_DURATION_MIN = 15;

/** Googleカレンダーへ送るイベント本体(必要最小限) */
export interface CalendarEventInput {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

/** カレンダーAPI呼び出しの結果。失敗時はHTTPステータスを持つ */
export type CalResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message?: string };

/**
 * カレンダーへの読み書きを担う口。本番はGIS+fetch、テストはモックを差し込む。
 * 401(トークン切れ)はバッチ側が refreshToken→1回だけ再試行して扱う。
 */
export interface CalendarClient {
  insertEvent(input: CalendarEventInput): Promise<CalResult>;
  patchEvent(eventId: string, input: CalendarEventInput): Promise<CalResult>;
  /** トークンを取り直す。成功で true(このあと呼び出しを1回だけ再試行する) */
  refreshToken(): Promise<boolean>;
}

/** 同期対象(=予定)か。date と planStart の両方があるものだけ送る */
export function isSyncableTask(t: Task): boolean {
  return !!t.date && !!t.planStart;
}

/**
 * Task をカレンダーイベント本体へ変換する。呼び出し側が isSyncableTask を保証する前提。
 * 見積0/未設定は15分。終了が翌日にまたがる場合も dateTime がそのまま表現する。
 * メモ・リンク・カテゴリ・重要度・実績などは載せない(件名・開始・終了だけ)。
 */
export function taskToEvent(task: Task): CalendarEventInput {
  const startMin = hhmmToMin(task.planStart) ?? 0;
  const dur = task.estimateMin && task.estimateMin > 0 ? task.estimateMin : DEFAULT_DURATION_MIN;
  const total = startMin + dur;
  const endDate = addToDate(task.date as string, "day", Math.floor(total / 1440));
  const endTime = minToHHMM(total % 1440);
  return {
    summary: task.title,
    start: { dateTime: `${task.date}T${task.planStart}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: TIME_ZONE },
  };
}

/** バッチ結果 */
export interface SyncSummary {
  /** 新規作成した件数 */
  created: number;
  /** 既存イベントを更新した件数(404で作り直した分も含む) */
  updated: number;
  /** 予定でない(時刻なし)ためスキップした件数 */
  skipped: number;
  /** 失敗した件(タイトルと理由) */
  failed: { title: string; reason: string }[];
}

function reasonOf(r: { status: number; message?: string }): string {
  if (r.message) return r.message;
  switch (r.status) {
    case 401:
      return "認証切れ";
    case 403:
      return "権限不足またはレート超過";
    case 404:
      return "イベントが見つかりません";
    default:
      return `エラー(${r.status})`;
  }
}

/** 401ならトークンを取り直して1回だけ再試行する */
async function callWithAuthRetry(
  client: CalendarClient,
  call: () => Promise<CalResult>
): Promise<CalResult> {
  const r = await call();
  if (!r.ok && r.status === 401 && (await client.refreshToken())) {
    return call();
  }
  return r;
}

/**
 * 選択タスクを1件ずつカレンダーへ upsert する。変更検知はせず常に現在値で書き込む。
 *   - 予定でないものはスキップ
 *   - gcalEventId 無 → insert / 有 → patch
 *   - patch が404(カレンダー側で消えていた) → insert にフォールバックして作り直す
 *   - 401 → トークンを取り直して1回だけ再試行
 *   - 1件失敗しても止めず、成功分だけ onSyncedId で id を保存し、最後に集計を返す
 */
export async function syncTasksToCalendar(
  tasks: Task[],
  client: CalendarClient,
  onSyncedId: (taskId: string, eventId: string) => void
): Promise<SyncSummary> {
  const summary: SyncSummary = { created: 0, updated: 0, skipped: 0, failed: [] };

  for (const task of tasks) {
    if (!isSyncableTask(task)) {
      summary.skipped++;
      continue;
    }
    const input = taskToEvent(task);
    try {
      if (!task.gcalEventId) {
        const r = await callWithAuthRetry(client, () => client.insertEvent(input));
        if (r.ok) {
          onSyncedId(task.id, r.id);
          summary.created++;
        } else {
          summary.failed.push({ title: task.title, reason: reasonOf(r) });
        }
        continue;
      }

      const eventId = task.gcalEventId;
      let r = await callWithAuthRetry(client, () => client.patchEvent(eventId, input));
      if (!r.ok && r.status === 404) {
        // カレンダー側で手動削除された等 → 作り直す
        r = await callWithAuthRetry(client, () => client.insertEvent(input));
      }
      if (r.ok) {
        onSyncedId(task.id, r.id);
        summary.updated++;
      } else {
        summary.failed.push({ title: task.title, reason: reasonOf(r) });
      }
    } catch (e) {
      summary.failed.push({
        title: task.title,
        reason: e instanceof Error ? e.message : "不明なエラー",
      });
    }
  }

  return summary;
}
