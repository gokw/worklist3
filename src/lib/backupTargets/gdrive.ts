// ==============================================================
// バックアップ先: Google ドライブ(Drive REST + GIS トークン)
//   FSA が使えない環境(Android 等)でも自動バックアップを成立させるための保存先。
//   ここは外部(Google認証・ネットワーク)に依存するため自動テストの対象外
//   (gcalClient.ts と同じ位置づけ。方針ロジックは backup.ts 側でテストする)。
//
//   ・スコープは drive.file。アプリが作ったファイルだけを扱う最小権限で、
//     かつユーザーは Drive の画面で普通に見てダウンロードできる
//     (appdata の隠し領域は「最後の砦が目視できない」ので採らない)
//   ・アクセストークンはメモリのみ。localStorage に持つのは
//     Client ID・端末名・ファイルID(機微でない値)だけ
//   ・複数端末が同じファイルを潰し合わないよう、ファイル名に端末名を含める
// ==============================================================
import { GoogleTokenSource } from "../googleAuth";
import { decodeBackupBytes, gzipText, verifyGzipped } from "../gzip";
import {
  type BackupBody,
  type BackupTarget,
  type ConnectResult,
  type DailyEntry,
  dailyFileDate,
  dailyFileName,
  mirrorFileName,
} from "./types";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** マイドライブ直下に作るフォルダと、その中の日次コピー用フォルダ */
const ROOT_FOLDER = "worklist3";
const ROTATION_FOLDER = "backups";

const LS_CLIENT_ID = "worklist3.gdrive.clientId";
const LS_DEVICE = "worklist3.gdrive.device";
const LS_COMPRESS = "worklist3.gdrive.compress";

/**
 * 設定の入れ物。モジュールの読み込み時点ではブラウザの外(テスト等)にいることがあるので、
 * localStorage には必ずこの関数越しに触る。
 */
function ls(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export interface GdriveConfig {
  clientId: string;
  /** 端末名。ファイル名に入れて、複数端末が同じファイルを潰し合わないようにする */
  device: string;
}

export function loadGdriveConfig(): GdriveConfig {
  const store = ls();
  return {
    clientId: store?.getItem(LS_CLIENT_ID) ?? "",
    device: store?.getItem(LS_DEVICE) ?? "",
  };
}

export function saveGdriveConfig(c: Partial<GdriveConfig>): void {
  const store = ls();
  if (!store) return;
  if (c.clientId !== undefined) store.setItem(LS_CLIENT_ID, c.clientId.trim());
  if (c.device !== undefined) store.setItem(LS_DEVICE, c.device.trim());
}

/** 認証が切れた・設定が足りないなど、再接続で直る種類の失敗 */
class NeedsReconnect extends Error {}

/** Drive のエラー応答から、人が読める理由を取り出す */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    /* JSON でなければ本文をそのまま使う */
  }
  try {
    return (await res.text()).slice(0, 200) || res.statusText;
  } catch {
    return res.statusText;
  }
}

export class GdriveBackupTarget implements BackupTarget {
  readonly id = "gdrive" as const;
  readonly label = "Google ドライブ";
  /** fetch さえあれば動く(FSA と違いブラウザを選ばない) */
  readonly supported = typeof fetch === "function";

  /** モバイル回線を想定するので既定は圧縮あり */
  compress = ls()?.getItem(LS_COMPRESS) !== "0";

  /** ネットワーク越しなので、通信量と電池のために長めにまとめる */
  readonly debounceMs = 30_000;

  private readonly tokens = new GoogleTokenSource(SCOPE);
  private connected = false;
  private folderId: string | null = null;
  private rotationFolderId: string | null = null;
  private mirrorId: string | null = null;

  get displayName(): string {
    return loadGdriveConfig().device;
  }

  setCompress(on: boolean): void {
    this.compress = on;
    ls()?.setItem(LS_COMPRESS, on ? "1" : "0");
  }

  /** ファイル名の接頭辞。端末名を含めることで端末ごとに別ファイルになる */
  private get prefix(): string {
    return `${ROOT_FOLDER}-${loadGdriveConfig().device}`;
  }

  // ---- 認証 ----

  /**
   * アクセストークンを用意する。
   * interactive=true(ユーザーがボタンを押した接続時)のときだけ同意画面を出してよい。
   * 書き込み中の失効からの復帰は非interactiveで、駄目なら再接続を促す。
   */
  private async token(interactive = false): Promise<string> {
    const cached = this.tokens.current;
    if (cached) return cached;
    const { clientId } = loadGdriveConfig();
    if (!clientId) throw new NeedsReconnect("Client ID が設定されていません");
    let token: string;
    try {
      token = await this.tokens.acquire(clientId, interactive);
    } catch (e) {
      const detail = e instanceof Error && e.message ? `: ${e.message}` : "";
      throw new NeedsReconnect(
        interactive
          ? `Google の認証に失敗しました${detail}`
          : "Google の認証が切れています。💾メニューから再接続してください"
      );
    }
    // 同じ Client ID で別のスコープ(カレンダー等)を既に許可していると、
    // Drive のぶんだけ落ちたトークンが返ることがある。その状態で API を叩くと
    // 403 になるだけで理由が分からないため、ここで先に捕まえる。
    if (this.tokens.missingRequestedScope) {
      throw new NeedsReconnect(
        "Google ドライブへのアクセスが許可されていません。" +
          "同意画面で「Google ドライブ」の項目にチェックを入れてください" +
          "(Cloud Console 側で Drive API の有効化とスコープ drive.file の追加も必要です)"
      );
    }
    return token;
  }

  /**
   * Drive API を叩く。401(トークン失効)なら1度だけ黙って取り直して再試行する。
   * ネットワーク起因の失敗は TypeError のまま投げ、呼び出し側でオフライン扱いにする。
   */
  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.token();
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      this.tokens.forget();
      return await this.call(url, init, false);
    }
    if (!res.ok && res.status !== 404) {
      // Google が返す理由をそのまま見せる。「API が有効になっていない」
      // 「スコープが足りない」はここでしか区別できず、握り潰すと原因が追えない。
      throw new Error(`Drive API エラー (${res.status}): ${await errorMessage(res)}`);
    }
    return res;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.call(url, init)).json()) as T;
  }

  // ---- フォルダ・ファイルの解決 ----

  /** 名前でフォルダを探し、無ければ作る。drive.file なので自分が作ったものだけが見える */
  private async ensureFolder(name: string, parent?: string): Promise<string> {
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='${FOLDER_MIME}'`,
      "trashed=false",
      parent ? `'${parent}' in parents` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const found = await this.json<{ files?: { id: string }[] }>(
      `${API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`
    );
    if (found.files?.length) return found.files[0].id;
    const created = await this.json<{ id: string }>(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parent ? { parents: [parent] } : {}),
      }),
    });
    return created.id;
  }

  private async folders(): Promise<{ root: string; rotation: string }> {
    if (!this.folderId) this.folderId = await this.ensureFolder(ROOT_FOLDER);
    if (!this.rotationFolderId)
      this.rotationFolderId = await this.ensureFolder(ROTATION_FOLDER, this.folderId);
    return { root: this.folderId, rotation: this.rotationFolderId };
  }

  /** 名前でファイルを1件探す。無ければ null */
  private async findFile(name: string, parent: string): Promise<string | null> {
    const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and trashed=false`;
    const r = await this.json<{ files?: { id: string }[] }>(
      `${API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`
    );
    return r.files?.[0]?.id ?? null;
  }

  // ---- 接続 ----

  private async attach(interactive: boolean): Promise<ConnectResult> {
    const { clientId, device } = loadGdriveConfig();
    if (!clientId || !device) {
      return {
        ok: false,
        displayName: device,
        problem: "Client ID と端末名を設定してください",
        needsReconnect: true,
      };
    }
    try {
      await this.token(interactive);
      await this.folders();
      this.connected = true;
      return { ok: true, displayName: device };
    } catch (e) {
      this.connected = false;
      // 汎用文言で潰さず、失敗した理由をそのまま出す。
      // 外部サービスの設定不備が原因なので、ここが分からないと手の打ちようがない。
      const message = e instanceof Error && e.message ? e.message : String(e);
      return {
        ok: false,
        displayName: device,
        problem: message,
        needsReconnect: true,
      };
    }
  }

  /** ユーザーがボタンを押した接続。同意画面を出してよい */
  connect(): Promise<ConnectResult> {
    return this.attach(true);
  }

  restore(): Promise<ConnectResult> {
    // 設定が無いなら何もしない(起動時に認証画面を出さない)
    const { clientId, device } = loadGdriveConfig();
    if (!clientId || !device) return Promise.resolve({ ok: false, displayName: "" });
    return this.attach(false);
  }

  reconnect(): Promise<ConnectResult> {
    this.tokens.forget();
    return this.attach(true);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.folderId = null;
    this.rotationFolderId = null;
    this.mirrorId = null;
    this.tokens.reset();
  }

  async ensureWritable(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.token(); // 失効していれば黙って取り直す
      return true;
    } catch {
      return false;
    }
  }

  // ---- 読み書き ----

  /** 保管形式に合わせて中身を作る。圧縮するときは書く前に読み戻せることを確かめる */
  private async encode(body: BackupBody): Promise<{ blob: Blob; type: string }> {
    if (!this.compress) {
      return { blob: new Blob([body.toJson(true)]), type: "application/json" };
    }
    const gz = await gzipText(body.toJson(false));
    const reason = await verifyGzipped(gz, body.count);
    if (reason) throw new Error(reason);
    return { blob: new Blob([gz]), type: "application/gzip" };
  }

  async readMirrorCount(): Promise<number | null> {
    if (!this.connected) return null;
    const { root } = await this.folders();
    // 圧縮の設定を切り替えた直後は旧形式しか無いことがあるので、両方を見る
    for (const compress of [this.compress, !this.compress]) {
      const id = await this.findFile(mirrorFileName(this.prefix, compress), root);
      if (!id) continue;
      try {
        const res = await this.call(`${API}/${id}?alt=media`);
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const parsed = JSON.parse(await decodeBackupBytes(bytes));
        if (Array.isArray(parsed)) {
          if (compress === this.compress) this.mirrorId = id;
          return parsed.length;
        }
      } catch {
        /* 次の形式を試す */
      }
    }
    return null;
  }

  async writeMirror(body: BackupBody): Promise<void> {
    const { root } = await this.folders();
    const name = mirrorFileName(this.prefix, this.compress);
    const { blob, type } = await this.encode(body);

    if (!this.mirrorId) this.mirrorId = await this.findFile(name, root);

    if (this.mirrorId) {
      // 中身だけ差し替える。新リビジョンが一斉に見えるので読み手からは原子的
      const res = await this.call(`${UPLOAD}/${this.mirrorId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": type },
        body: blob,
      });
      if (res.status === 404) {
        // Drive 側で手動削除されていた。作り直す(カレンダー連携と同じフォールバック)
        this.mirrorId = null;
      } else {
        return;
      }
    }

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify({ name, parents: [root] })], { type: "application/json" })
    );
    form.append("file", blob, name);
    const created = await this.json<{ id: string }>(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: "POST",
      body: form,
    });
    this.mirrorId = created.id;
  }

  /**
   * 日次コピーはサーバー側の複製(files.copy)で作る。アップロードのバイト数がゼロになるため、
   * モバイル回線での通信量が実質ミラーぶんだけで済む。
   * 同名のファイルは Drive では別物として増えていくので、
   * 「新しく複製してから古いものを消す」順で入れ替える(途中で失敗しても控えが消えない)。
   */
  async writeDaily(_body: BackupBody, date: string): Promise<void> {
    if (!this.mirrorId) return; // ミラーが無いなら複製元が無い
    const { rotation } = await this.folders();
    const name = dailyFileName(this.prefix, date, this.compress);
    const old = await this.findFile(name, rotation);
    await this.json<{ id: string }>(`${API}/${this.mirrorId}/copy?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parents: [rotation] }),
    });
    if (old) await this.trash(old);
  }

  private async trash(id: string): Promise<void> {
    await this.call(`${API}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async listDaily(): Promise<DailyEntry[]> {
    const { rotation } = await this.folders();
    const q = `'${rotation}' in parents and trashed=false`;
    const r = await this.json<{ files?: { id: string; name: string }[] }>(
      `${API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`
    );
    const out: DailyEntry[] = [];
    for (const f of r.files ?? []) {
      const date = dailyFileDate(this.prefix, f.name);
      if (date) out.push({ key: f.id, name: f.name, date });
    }
    return out;
  }

  /** 完全削除ではなくゴミ箱へ。掃除を誤っても猶予期間内なら取り返せる */
  async deleteDaily(entry: DailyEntry): Promise<void> {
    await this.trash(entry.key);
  }

  /** 旧形式(圧縮設定を切り替える前)のミラーを消す。ミラーは常に1つだけ残す */
  async removeStaleMirror(): Promise<void> {
    if (!this.connected) return;
    const { root } = await this.folders();
    const id = await this.findFile(mirrorFileName(this.prefix, !this.compress), root);
    if (id) await this.trash(id);
  }

  /** 復元用: 控えの中身を JSON 文字列で取り出す(圧縮されていれば展開する) */
  async readEntry(entry: DailyEntry | "mirror"): Promise<string> {
    const id = entry === "mirror" ? this.mirrorId : entry.key;
    if (!id) throw new Error("控えが見つかりません");
    const res = await this.call(`${API}/${id}?alt=media`);
    if (!res.ok) throw new Error("控えを取得できませんでした");
    return await decodeBackupBytes(new Uint8Array(await res.arrayBuffer()));
  }
}
