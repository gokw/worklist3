// ==============================================================
// 接続が成立したあとに手番を確認するか(#125)
//
//   refreshBaton() は「Drive に接続済み」でなければ何もしない。起動時の
//   呼び出しは接続を待たずに走るので毎回空振りし、接続後に確かめ直す経路が
//   無かった。その結果、起動してすぐ操作を始めると、他端末へ手番が移っていても
//   気づけず(バナーも出ず編集も止まらず)、最初の編集から30秒後の
//   バックアップ直前の確認まで降格が分からなかった。
//
//   「黙って空振りする」種類の不具合なので、手番ファイルを実際に読みに
//   行ったかどうかをHTTPの観測で固定する。
// ==============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const OWNER_FILE = "worklist3-private-owner.json";

let requested: string[];
/** 手番ファイルの持ち主。別端末のIDにすると「奪われている」状態になる */
let ownerDeviceId: string;

beforeEach(() => {
  vi.resetModules(); // モジュールの状態を毎回まっさらにする
  requested = [];
  ownerDeviceId = "other-device";
  const data = new Map<string, string>([
    ["worklist3.backup.target", "gdrive"], // 既定はローカルフォルダなので明示する
    ["worklist3.gdrive.clientId", "test-client-id"],
    ["worklist3.gdrive.group", "private"],
    ["worklist3.baton.enabled", "1"],
    ["worklist3.device.id", "this-device"],
    ["worklist3.baton.owned", "1"], // キャッシュ上は「自分がメイン」
    ["worklist3.baton.ownerName", "このスマホ"],
    [
      "worklist3.gauth." + SCOPE,
      JSON.stringify({ token: "tok", expiresAt: Date.now() + 3_600_000, scopes: [SCOPE] }),
    ],
  ]);
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };

  // backup.ts は window / document を触る(online リスナ、操作起点のトークン更新)
  (globalThis as unknown as { window: unknown }).window = {
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const q = decodeURIComponent(url);
    requested.push(`${method} ${q}`);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (q.includes("google-apps.folder")) return json({ files: [{ id: "folder" }] });
    // 手番ファイルの中身
    if (q.includes(`/files/owner-id`)) return json({ deviceId: ownerDeviceId, deviceName: "自宅PC" });
    if (method === "GET" && q.includes(`name='${OWNER_FILE}'`)) return json({ files: [{ id: "owner-id" }] });
    if (method === "GET" && q.includes("name='")) return json({ files: [] });
    if (method === "GET" && q.includes("alt=media")) return new Response("[]", { status: 200 });
    if (method === "GET") return json({ files: [] });
    return json({ id: "new-file" });
  };
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("接続が成立したら手番を確認する(#125)", () => {
  it("restoreBackupDir のあと、手番ファイルを読みに行っている", async () => {
    const { restoreBackupDir } = await import("./backup");
    await restoreBackupDir([]);
    // refreshBaton は待たない(void)ので、投げられた往復が終わるのを待つ
    await new Promise((r) => setTimeout(r, 50));

    const readOwner = requested.filter((r) => r.includes(OWNER_FILE) || r.includes("/files/owner-id"));
    // ここが0件に戻ると、起動直後に「自分はまだメイン」と思い込んだまま
    // 操作できてしまう状態へ逆戻りする
    expect(readOwner.length).toBeGreaterThan(0);
  });

  it("他端末が持っていれば、読み取り専用(guest)に落ちる", async () => {
    const { restoreBackupDir } = await import("./backup");
    const { getBatonState } = await import("./baton");
    await restoreBackupDir([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(getBatonState().role).toBe("guest");
    expect(getBatonState().ownerName).toBe("自宅PC");
  });
});
