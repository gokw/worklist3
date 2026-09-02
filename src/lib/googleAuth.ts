// ==============================================================
// Google 認証(GIS)の共有部分
//   カレンダー連携とドライブへのバックアップで、スクリプトの読み込みと
//   型定義を共有する。スコープごとにトークンクライアントが要るため、
//   トークンそのものは利用側が保持する。
//   ・アクセストークンは有効期限つきで localStorage に保持する(#96)。
//     以前は「メモリのみ」だったが、リロード・タブ破棄のたびに認証画面を
//     経由する原因だった。主保存データ(タスク全件)が同じ localStorage に
//     ある以上、トークンだけメモリに置いても防御線にならない、と再評価した
//     (変更仕様書_Drive接続の維持.md §3-1)。切断時は必ず消して revoke する。
// ==============================================================

const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface TokenResponse {
  access_token?: string;
  /** トークンの寿命(秒)。Google の既定は約1時間 */
  expires_in?: number;
  /** 実際に許可されたスコープ(空白区切り)。要求どおりとは限らない */
  scope?: string;
  error?: string;
  error_description?: string;
}

/** ポップアップ起因の失敗(OAuth 応答の外)。error_callback で受け取る */
export interface TokenClientError {
  type: string;
  message?: string;
}

export interface TokenClient {
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
            error_callback?: (err: TokenClientError) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;

/** GIS のスクリプトを1度だけ読み込む */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google認証スクリプトを読み込めませんでした"));
    document.head.appendChild(s);
  }).catch((e) => {
    gisLoading = null; // 失敗したら次回もう一度試せるようにする
    throw e;
  });
  return gisLoading;
}

// -------------------------------------------------------------
// トークンの期限(純粋関数。テスト対象)
// -------------------------------------------------------------

/** 取得直後に使い切れず失効する事故を避ける余裕(仕様書 §3-2) */
const EXPIRY_MARGIN_MS = 60_000;
/** expires_in が返らなかったときに仮定する寿命。Google の既定は約1時間 */
const DEFAULT_LIFETIME_SEC = 3600;
/** 残りがこれを切っていたら、ユーザー操作のついでに取り直す(仕様書 §3-4) */
export const RENEW_BEFORE_MS = 10 * 60_000;
/** ポップアップ失敗が error_callback にも届かなかったときの保険(仕様書 §3-3) */
const ACQUIRE_TIMEOUT_MS = 60_000;

/** 取得時刻と expires_in から、失効とみなす時刻(ms)を決める */
export function tokenExpiresAt(now: number, expiresInSec: number | undefined): number {
  return now + (expiresInSec ?? DEFAULT_LIFETIME_SEC) * 1000 - EXPIRY_MARGIN_MS;
}

/** まだ使ってよいトークンか */
export function tokenAlive(expiresAt: number, now: number): boolean {
  return now < expiresAt;
}

/** 失効が近く、ユーザー操作のついでに取り直すべきか(失効済みも含む) */
export function tokenNearExpiry(expiresAt: number, now: number, before = RENEW_BEFORE_MS): boolean {
  return expiresAt - now < before;
}

// -------------------------------------------------------------
// トークンの保存(localStorage)
// -------------------------------------------------------------

const STORE_PREFIX = "worklist3.gauth.";

export interface StoredToken {
  token: string;
  /** 失効とみなす時刻(ms)。余裕(EXPIRY_MARGIN_MS)を差し引き済み */
  expiresAt: number;
  /** 実際に許可されたスコープ */
  scopes: string[];
}

/** 保存値を読む。壊れている・期限切れなら null(「無い」と同じ扱い) */
export function parseStoredToken(raw: string | null, now: number): StoredToken | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof v.token !== "string" || !v.token) return null;
    if (typeof v.expiresAt !== "number" || !tokenAlive(v.expiresAt, now)) return null;
    const scopes = Array.isArray(v.scopes)
      ? v.scopes.filter((s): s is string => typeof s === "string")
      : [];
    return { token: v.token, expiresAt: v.expiresAt, scopes };
  } catch {
    return null;
  }
}

/** モジュールの読み込み時点ではブラウザの外(テスト等)にいることがある */
function store(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** 取得の求め方。仕様書 §3-6 */
export type AcquireMode =
  /** 画面を出さない(prompt:"")。同意済み+Googleセッションありなら黙って取れる */
  | "silent"
  /** ユーザー操作起点の接続。必要な画面の選択は GIS に委ねる(prompt 未指定) */
  | "interactive"
  /** 同意画面を強制する。スコープを付け直すときだけ使う */
  | "consent";

/**
 * 1つのスコープぶんのアクセストークンを預かる。
 *
 * ・取得したトークンは期限つきで localStorage に保存し、リロード後も
 *   期限内なら GIS を呼ばずに使う(#96)。
 * ・`requestAccessToken` はポップアップを経由するため、ユーザー操作の外から
 *   呼ぶとブロックされて失敗し得る。その失敗は error_callback でしか
 *   検知できないので必ず設定し、さらにタイムアウトの保険を掛けて
 *   **acquire() の Promise が必ず確定する**ようにする(仕様書 §3-3)。
 *   確定しないと、呼び出し側(backup.ts の flush)が固まったままになる。
 *
 * 許可されたスコープは要求どおりとは限らない(同じClient IDで別スコープを
 * 既に許可していると、新しいぶんだけ落ちたトークンが返ることがある)ので、
 * granted で確認できるようにしておく。
 */
export class GoogleTokenSource {
  private token: string | null = null;
  private expiresAt = 0;
  private grantedScopes: string[] = [];
  private client: TokenClient | null = null;
  private clientIdOfClient: string | null = null;
  /** localStorage からの読み戻しを済ませたか(遅延読み込み) */
  private loaded = false;
  /** 進行中の取得。callback の差し替えが競合しないよう直列化する */
  private inFlight: Promise<string> | null = null;
  /** initTokenClient に渡す実体。acquire ごとに差し替える */
  private onResponse: ((resp: TokenResponse) => void) | null = null;
  private onError: ((err: TokenClientError) => void) | null = null;

  constructor(private readonly scope: string) {}

  private get storeKey(): string {
    return STORE_PREFIX + this.scope;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const saved = parseStoredToken(store()?.getItem(this.storeKey) ?? null, Date.now());
    if (saved) {
      this.token = saved.token;
      this.expiresAt = saved.expiresAt;
      this.grantedScopes = saved.scopes;
    }
  }

  private persist(): void {
    const s: StoredToken = {
      token: this.token ?? "",
      expiresAt: this.expiresAt,
      scopes: this.grantedScopes,
    };
    store()?.setItem(this.storeKey, JSON.stringify(s));
  }

  private clearStored(): void {
    store()?.removeItem(this.storeKey);
  }

  /** 期限内のトークン。無い・期限切れなら null */
  get current(): string | null {
    this.ensureLoaded();
    if (this.token && tokenAlive(this.expiresAt, Date.now())) return this.token;
    // 手元が失効していても、別タブが取り直して保存し直していることがある。
    // 読み戻せれば、このタブは再取得(認証画面)を経ずに済む
    const saved = parseStoredToken(store()?.getItem(this.storeKey) ?? null, Date.now());
    if (saved) {
      this.token = saved.token;
      this.expiresAt = saved.expiresAt;
      this.grantedScopes = saved.scopes;
      return saved.token;
    }
    return null;
  }

  /** トークンが無い・失効間近で、ユーザー操作のついでに取り直すべきか(仕様書 §3-4) */
  shouldRenew(now = Date.now()): boolean {
    if (!this.current) return true; // current が保存の読み戻しも兼ねる
    return tokenNearExpiry(this.expiresAt, now);
  }

  /**
   * 直近のトークンに、このソースが要求したスコープが含まれていないと分かっているか。
   * GIS が scope を返さないこともあるので、情報が無いときは「欠けている」とは断じない
   * (誤判定で正常な接続を止めないため、判断できないときは通す)。
   */
  get missingRequestedScope(): boolean {
    this.ensureLoaded();
    return this.grantedScopes.length > 0 && !this.grantedScopes.includes(this.scope);
  }

  private async ensureClient(clientId: string): Promise<TokenClient> {
    await loadGis();
    if (this.client && this.clientIdOfClient === clientId) return this.client;
    this.client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: this.scope,
      // 実体は acquire 内で毎回差し替える。error_callback はポップアップが
      // 開けなかった/閉じられた事象を拾う唯一の口(仕様書 §3-3)
      callback: (resp) => this.onResponse?.(resp),
      error_callback: (err) => this.onError?.(err),
    });
    this.clientIdOfClient = clientId;
    return this.client;
  }

  async acquire(clientId: string, mode: AcquireMode = "silent"): Promise<string> {
    // 進行中の取得があれば終わりを待つ(成否は問わない)。callback の競合を避ける
    while (this.inFlight) {
      await this.inFlight.catch(() => {});
    }
    // 待っている間に別の取得が成功していたら、無音要求はそれで足りる
    if (mode === "silent") {
      const live = this.current;
      if (live) return live;
    }
    const run = this.request(clientId, mode);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  private async request(clientId: string, mode: AcquireMode): Promise<string> {
    const client = await this.ensureClient(clientId);
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.onResponse = null;
        this.onError = null;
        fn();
      };
      // ユーザー操作の文脈で呼べばポップアップは許されるが、万一 callback も
      // error_callback も呼ばれない事態に備えて必ず確定させる(仕様書 §3-3)
      const timer = window.setTimeout(
        () => settle(() => reject(new Error("アクセストークンの取得がタイムアウトしました"))),
        ACQUIRE_TIMEOUT_MS
      );
      this.onResponse = (resp) => {
        if (resp.error || !resp.access_token) {
          settle(() =>
            reject(
              new Error(
                resp.error_description ?? resp.error ?? "アクセストークンを取得できませんでした"
              )
            )
          );
          return;
        }
        const token = resp.access_token;
        this.token = token;
        this.expiresAt = tokenExpiresAt(Date.now(), resp.expires_in);
        this.grantedScopes = (resp.scope ?? "").split(" ").filter(Boolean);
        this.persist();
        settle(() => resolve(token));
      };
      this.onError = (err) => {
        const message =
          err.type === "popup_failed_to_open"
            ? "認証画面を開けませんでした(ポップアップブロック)"
            : err.type === "popup_closed"
              ? "認証画面が閉じられました"
              : (err.message ?? "アクセストークンを取得できませんでした");
        settle(() => reject(new Error(message)));
      };
      try {
        // silent: 画面を出さない(未同意のスコープはこれでは許可されない)。
        // interactive: prompt を指定せず、必要な画面だけを GIS に出させる(§3-6)。
        // consent: 同意画面を強制(スコープの付け直しはこれでないと通らない)。
        if (mode === "silent") client.requestAccessToken({ prompt: "" });
        else if (mode === "consent") client.requestAccessToken({ prompt: "consent" });
        else client.requestAccessToken();
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error("トークン要求に失敗しました")));
      }
    });
  }

  /** 失効を検知したときに呼ぶ。保存も消し、次の acquire で取り直す */
  forget(): void {
    this.ensureLoaded();
    this.token = null;
    this.expiresAt = 0;
    this.grantedScopes = [];
    this.clearStored();
  }

  /** トークンを破棄し(保存も消す)、可能なら失効させて再同意できるようにする */
  reset(): void {
    this.ensureLoaded();
    const t = this.token;
    this.token = null;
    this.expiresAt = 0;
    this.grantedScopes = [];
    this.clearStored();
    if (t && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(t);
      } catch {
        /* 失効はベストエフォート(トークン破棄は済んでいる) */
      }
    }
  }
}
