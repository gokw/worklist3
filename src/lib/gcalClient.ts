// ==============================================================
// Googleカレンダー連携: 本番クライアント(GISトークン + fetch)と設定の保持
//   ここは外部(Google認証・ネットワーク)に依存するため自動テストの対象外。
//   純粋ロジック(gcalMap.ts)から使う CalendarClient を実装する。
//
//   ・アクセストークンはメモリ保持のみ(localStorageへ永続化しない)
//   ・localStorageに持つのは Client ID / Calendar ID(機微でない値)だけ
//   ・トークン取得はユーザー操作(📅ボタン)起点で呼ぶ(ポップアップブロック回避)
// ==============================================================
import type { CalendarClient, CalendarEventInput, CalResult } from "./gcalMap";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const API_BASE = "https://www.googleapis.com/calendar/v3/calendars";

const LS_CLIENT_ID = "worklist3.gcal.clientId";
const LS_CALENDAR_ID = "worklist3.gcal.calendarId";

// ---- GIS(Google Identity Services)の最小型定義 ----
interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
  callback: (resp: TokenResponse) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

// -------------------------------------------------------------
// 設定(Client ID / Calendar ID)。プレーン文字列でlocalStorageに持つ
// -------------------------------------------------------------
export interface GcalConfig {
  clientId: string;
  calendarId: string;
}

export function loadGcalConfig(): GcalConfig {
  return {
    clientId: localStorage.getItem(LS_CLIENT_ID) ?? "",
    calendarId: localStorage.getItem(LS_CALENDAR_ID) ?? "",
  };
}

export function saveGcalConfig(c: Partial<GcalConfig>): void {
  if (c.clientId !== undefined) localStorage.setItem(LS_CLIENT_ID, c.clientId.trim());
  if (c.calendarId !== undefined) localStorage.setItem(LS_CALENDAR_ID, c.calendarId.trim());
}

// -------------------------------------------------------------
// 認証(トークンはメモリのみ)
// -------------------------------------------------------------
let accessToken: string | null = null;
let tokenClient: TokenClient | null = null;
let tokenClientId: string | null = null;
let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google認証スクリプトを読み込めませんでした"));
    document.head.appendChild(s);
  });
  return gisLoading;
}

async function ensureTokenClient(clientId: string): Promise<TokenClient> {
  await loadGis();
  if (tokenClient && tokenClientId === clientId) return tokenClient;
  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: () => {}, // 実際のcallbackは acquireToken 内で毎回差し替える
  });
  tokenClientId = clientId;
  return tokenClient;
}

/**
 * アクセストークンを取得する(ユーザー操作起点で呼ぶこと)。
 * prompt:'' なので、同意済みかつGoogleセッションがあれば画面は出ない。
 * 初回や未同意のときだけGISが同意画面を出す。取得したトークンはメモリに置く。
 */
export function acquireToken(clientId: string): Promise<string> {
  return ensureTokenClient(clientId).then(
    (client) =>
      new Promise<string>((resolve, reject) => {
        client.callback = (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? "アクセストークンを取得できませんでした"));
          } else {
            accessToken = resp.access_token;
            resolve(resp.access_token);
          }
        };
        try {
          client.requestAccessToken({ prompt: "" });
        } catch (e) {
          reject(e instanceof Error ? e : new Error("トークン要求に失敗しました"));
        }
      })
  );
}

/** 連携をリセット: メモリのトークンを破棄し、可能なら失効させて再同意できるようにする */
export function resetGcalAuth(): void {
  const t = accessToken;
  accessToken = null;
  if (t && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(t);
    } catch {
      /* 失効はベストエフォート(トークン破棄は済んでいる) */
    }
  }
}

// -------------------------------------------------------------
// CalendarClient 本番実装
// -------------------------------------------------------------
export function createGoogleCalendarClient(clientId: string, calendarId: string): CalendarClient {
  const eventsUrl = (suffix = "") =>
    `${API_BASE}/${encodeURIComponent(calendarId)}/events${suffix}`;

  async function send(
    method: "POST" | "PATCH",
    suffix: string,
    body: CalendarEventInput
  ): Promise<CalResult> {
    if (!accessToken) {
      // 通常はボタン押下時に取得済み。念のため取れなければ401扱いにして上位のリトライへ委ねる
      try {
        await acquireToken(clientId);
      } catch (e) {
        return { ok: false, status: 401, message: e instanceof Error ? e.message : undefined };
      }
    }
    const res = await fetch(eventsUrl(suffix), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = (await res.json()) as { id: string };
      return { ok: true, id: json.id };
    }
    return { ok: false, status: res.status };
  }

  return {
    insertEvent: (input) => send("POST", "", input),
    patchEvent: (eventId, input) => send("PATCH", `/${encodeURIComponent(eventId)}`, input),
    async refreshToken() {
      try {
        await acquireToken(clientId);
        return true;
      } catch {
        return false;
      }
    },
  };
}
