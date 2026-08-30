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
  error?: string;
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
 * prompt:"" なので、同意済みかつGoogleセッションがあれば画面は出ない
 * (＝失効後の書き込みで黙って取り直せる)。未同意なら同意画面が出るが、
 * ユーザー操作起点でない場面ではブラウザに弾かれて失敗するだけなので、
 * 呼び出し側は「再接続してください」に落とすこと。
 */
export class GoogleTokenSource {
  private token: string | null = null;
  private client: TokenClient | null = null;
  private clientIdOfClient: string | null = null;

  constructor(private readonly scope: string) {}

  get current(): string | null {
    return this.token;
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

  async acquire(clientId: string): Promise<string> {
    const client = await this.ensureClient(clientId);
    return await new Promise<string>((resolve, reject) => {
      client.callback = (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? "アクセストークンを取得できませんでした"));
        } else {
          this.token = resp.access_token;
          resolve(resp.access_token);
        }
      };
      try {
        client.requestAccessToken({ prompt: "" });
      } catch (e) {
        reject(e instanceof Error ? e : new Error("トークン要求に失敗しました"));
      }
    });
  }

  /** 失効を検知したときに呼ぶ。次の acquire で取り直す */
  forget(): void {
    this.token = null;
  }

  /** メモリのトークンを破棄し、可能なら失効させて再同意できるようにする */
  reset(): void {
    const t = this.token;
    this.token = null;
    if (t && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(t);
      } catch {
        /* 失効はベストエフォート(トークン破棄は済んでいる) */
      }
    }
  }
}
