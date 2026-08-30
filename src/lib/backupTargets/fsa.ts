// ==============================================================
// バックアップ先: ローカルフォルダ(File System Access API)
//   従来の実装をそのまま保存先として切り出したもの。
//   書き出されるファイル・タイミング・警告は従来と同一であること。
//   OneDrive 等の同期フォルダを指してもらう前提なので、
//   アプリ自身はクラウドを知らない(同期クライアントに任せる)。
//   対応は Chromium系(Chrome/Edge)。非対応環境では supported=false。
// ==============================================================
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

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  }
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
  }
}

/** ミラー・日次コピーのファイル名の接頭辞(従来と同じ) */
const PREFIX = "worklist3";
const LS_COMPRESS = "worklist3.backup.fsa.compress";

/**
 * モジュールの読み込み時点ではブラウザの外(テスト等)にいることがあるので、
 * localStorage には必ずこの関数越しに触る。
 */
function safeStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
const ROTATION_DIR = "backups";

// -------------------------------------------------------------
// ディレクトリハンドルの永続化(IndexedDBにハンドル1個だけ。データ本体ではない)
// -------------------------------------------------------------
const IDB_NAME = "worklist3.backup";
const IDB_STORE = "handles";
const IDB_KEY = "backupDir";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRead(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openIdb();
  try {
    return await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbWrite(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE);
      const req = handle ? store.put(handle, IDB_KEY) : store.delete(IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// -------------------------------------------------------------
// 実装
// -------------------------------------------------------------
const NO_PERMISSION = "バックアップ先の権限がありません。再接続してください";

export class FsaBackupTarget implements BackupTarget {
  readonly id = "fsa" as const;
  readonly label = "ローカルフォルダ";
  readonly supported =
    typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

  /** ローカルはディスクが安く、人が読める方が価値が高いので既定は非圧縮 */
  compress = safeStorage()?.getItem(LS_COMPRESS) === "1";

  /** ローカルディスクなので従来どおり即時に近い */
  readonly debounceMs = 1500;

  private dir: FileSystemDirectoryHandle | null = null;

  get displayName(): string {
    return this.dir?.name ?? "";
  }

  setCompress(on: boolean): void {
    this.compress = on;
    safeStorage()?.setItem(LS_COMPRESS, on ? "1" : "0");
  }

  // ---- 接続 ----

  async connect(): Promise<ConnectResult> {
    if (!window.showDirectoryPicker) return { ok: false, displayName: "" };
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return { ok: false, displayName: "" }; // ユーザーがキャンセルした
    }
    return await this.attach(dir, true);
  }

  async restore(): Promise<ConnectResult> {
    if (!this.supported) return { ok: false, displayName: "" };
    try {
      const dir = await idbRead();
      if (!dir) return { ok: false, displayName: "" };
      return await this.attach(dir, false);
    } catch (e) {
      console.error("バックアップ先の復元に失敗しました", e);
      return { ok: false, displayName: "" };
    }
  }

  async reconnect(): Promise<ConnectResult> {
    let dir = this.dir;
    if (!dir) dir = (await idbRead().catch(() => undefined)) ?? null;
    if (!dir) return await this.connect(); // 記憶が無いなら選び直してもらう
    return await this.attach(dir, true);
  }

  private async attach(
    dir: FileSystemDirectoryHandle,
    interactive: boolean
  ): Promise<ConnectResult> {
    if (!(await this.ensurePermission(dir, interactive))) {
      this.dir = null;
      return {
        ok: false,
        displayName: dir.name,
        problem: NO_PERMISSION,
        needsReconnect: true,
      };
    }
    this.dir = dir;
    await idbWrite(dir).catch((e) => console.error("バックアップ先の記憶に失敗しました", e));
    return { ok: true, displayName: dir.name };
  }

  async disconnect(): Promise<void> {
    this.dir = null;
    await idbWrite(null).catch((e) => console.error("バックアップ先の解除に失敗しました", e));
  }

  private async ensurePermission(
    dir: FileSystemDirectoryHandle,
    interactive: boolean
  ): Promise<boolean> {
    const opts = { mode: "readwrite" as const };
    try {
      if ((await dir.queryPermission?.(opts)) === "granted") return true;
      // 再許可はユーザー操作起点でないとブラウザに弾かれるため、起動時は求めない
      if (!interactive) return false;
      return (await dir.requestPermission?.(opts)) === "granted";
    } catch {
      return false;
    }
  }

  async ensureWritable(): Promise<boolean> {
    if (!this.dir) return false;
    return await this.ensurePermission(this.dir, false);
  }

  // ---- 読み書き ----

  /**
   * JSONを1ファイル書く。
   * createWritable() は一時ファイル(スワップ)へ書き、close() で初めて本体へ差し替える
   * 仕様のため、同期途中の半端な内容が正式ファイルに現れることはない(原子的書き込み)。
   */
  private async write(
    dir: FileSystemDirectoryHandle,
    name: string,
    data: string | Uint8Array
  ): Promise<void> {
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
  }

  /** 保管形式に合わせて中身を作る。圧縮するときは書く前に読み戻せることを確かめる */
  private async encode(body: BackupBody): Promise<string | Uint8Array> {
    if (!this.compress) return body.toJson(true);
    const gz = await gzipText(body.toJson(false));
    const reason = await verifyGzipped(gz, body.count);
    if (reason) throw new Error(reason);
    return gz;
  }

  private requireDir(): FileSystemDirectoryHandle {
    if (!this.dir) throw new Error("バックアップ先が接続されていません");
    return this.dir;
  }

  async readMirrorCount(): Promise<number | null> {
    const dir = this.dir;
    if (!dir) return null;
    // 圧縮の設定を切り替えた直後は旧形式しか無いことがあるので、両方を見る
    for (const compress of [this.compress, !this.compress]) {
      try {
        const name = mirrorFileName(PREFIX, compress);
        const file = await (await dir.getFileHandle(name)).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = JSON.parse(await decodeBackupBytes(bytes));
        if (Array.isArray(parsed)) return parsed.length;
      } catch {
        /* 次の形式を試す */
      }
    }
    return null;
  }

  async writeMirror(body: BackupBody): Promise<void> {
    const dir = this.requireDir();
    await this.write(dir, mirrorFileName(PREFIX, this.compress), await this.encode(body));
  }

  async writeDaily(body: BackupBody, date: string): Promise<void> {
    const dir = this.requireDir();
    const backups = await dir.getDirectoryHandle(ROTATION_DIR, { create: true });
    await this.write(backups, dailyFileName(PREFIX, date, this.compress), await this.encode(body));
  }

  async listDaily(): Promise<DailyEntry[]> {
    const dir = this.requireDir();
    const backups = await dir.getDirectoryHandle(ROTATION_DIR, { create: true });
    const out: DailyEntry[] = [];
    for await (const name of backups.keys()) {
      const date = dailyFileDate(PREFIX, name);
      if (date) out.push({ key: name, name, date });
    }
    return out;
  }

  async deleteDaily(entry: DailyEntry): Promise<void> {
    const dir = this.requireDir();
    const backups = await dir.getDirectoryHandle(ROTATION_DIR, { create: true });
    try {
      await backups.removeEntry(entry.key);
    } catch (e) {
      // 既に消えていた(NotFoundError)は目的が達成済みなので無視する
      if ((e as DOMException)?.name !== "NotFoundError") throw e;
    }
  }

  /** 旧形式(圧縮設定を切り替える前)のミラーを消す。ミラーは常に1つだけ残す */
  async removeStaleMirror(): Promise<void> {
    const dir = this.dir;
    if (!dir) return;
    try {
      await dir.removeEntry(mirrorFileName(PREFIX, !this.compress));
    } catch (e) {
      if ((e as DOMException)?.name !== "NotFoundError")
        console.error("旧形式のミラーを消せませんでした", e);
    }
  }
}
