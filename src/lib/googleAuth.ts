// ==============================================================
// Google 認証(GIS)の共有部分
//   カレンダー連携とドライブへのバックアップで、スクリプトの読み込みと
//   型定義を共有する。スコープごとにトークンクライアントが要るため、
//   トークンそのものは利用側が保持する。
//   ・アクセストークンはメモリ保持のみ(localStorageへ永続化しない)
// ==============================================================

const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface TokenResponse {
  access_token?: string;
  /** 実際に許可されたスコープ(空白区切り)。要求どおりとは限らない */
  scope?: string;
  error?: string;
  error_description?: string;
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

/**
 * 1つのスコープぶんのアクセストークンを預かる。
 *
 * 同意の求め方を2通り使い分ける:
 *   ・interactive(ユーザーがボタンを押した接続時) … 同意画面を出してよい。
 *     新しいスコープを初めて許可してもらうときはこちらでないと通らない。
 *   ・非interactive(書き込み中の失効からの復帰) … prompt:"" で画面を出さない。
 *     同意済みかつGoogleセッションがあれば黙って取り直せる。駄目なら失敗させ、
 *     呼び出し側が「再接続してください」に落とす。
 *
 * 許可されたスコープは要求どおりとは限らない(同じClient IDで別スコープを
 * 既に許可していると、新しいぶんだけ落ちたトークンが返ることがある)ので、
 * granted で確認できるようにしておく。
 */
export class GoogleTokenSource {
  private token: string | null = null;
  private client: TokenClient | null = null;
  private clientIdOfClient: string | null = null;
  private grantedScopes: string[] = [];

  constructor(private readonly scope: string) {}

  get current(): string | null {
    return this.token;
  }

  /**
   * 直近のトークンに、このソースが要求したスコープが含まれていないと分かっているか。
   * GIS が scope を返さないこともあるので、情報が無いときは「欠けている」とは断じない
   * (誤判定で正常な接続を止めないため、判断できないときは通す)。
   */
  get missingRequestedScope(): boolean {
    return this.grantedScopes.length > 0 && !this.grantedScopes.includes(this.scope);
  }

  private async ensureClient(clientId: string): Promise<TokenClient> {
    await loadGis();
    if (this.client && this.clientIdOfClient === clientId) return this.client;
    this.client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: this.scope,
      callback: () => {}, // 実際のcallbackは acquire 内で毎回差し替える
    });
    this.clientIdOfClient = clientId;
    return this.client;
  }

  async acquire(clientId: string, interactive = false): Promise<string> {
    const client = await this.ensureClient(clientId);
    return await new Promise<string>((resolve, reject) => {
      client.callback = (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description ?? resp.error ?? "アクセストークンを取得できませんでした"
            )
          );
        } else {
          this.token = resp.access_token;
          this.grantedScopes = (resp.scope ?? "").split(" ").filter(Boolean);
          resolve(resp.access_token);
        }
      };
      try {
        // 同意画面を出してよい場面では consent を指定する。prompt:"" は
        // 「画面を出さない」意味なので、未同意のスコープはこれでは許可されない。
        client.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) {
        reject(e instanceof Error ? e : new Error("トークン要求に失敗しました"));
      }
    });
  }

  /** 失効を検知したときに呼ぶ。次の acquire で取り直す */
  forget(): void {
    this.token = null;
    this.grantedScopes = [];
  }

  /** メモリのトークンを破棄し、可能なら失効させて再同意できるようにする */
  reset(): void {
    const t = this.token;
    this.token = null;
    this.grantedScopes = [];
    if (t && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(t);
      } catch {
        /* 失効はベストエフォート(トークン破棄は済んでいる) */
      }
    }
  }
}
