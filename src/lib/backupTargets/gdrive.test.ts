// ==============================================================
// Drive 保存先のうち、#124 で穴が見つかった2点を固定する。
//
//   偽の localStorage と偽の fetch を差して、実際に投げる HTTP を観測する。
//   どちらもネットワーク越しの挙動なので純粋関数には切り出せないが、
//   **救出ファイルを取り出せなくなる経路**なので、ここは落とさずに見る。
// ==============================================================
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GdriveBackupTarget } from "./gdrive";

const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface Sent {
  url: string;
  method: string;
  /** 更新(PATCH)のときはヘッダに載る */
  contentType: string;
  /** 新規作成(multipart POST)のときは本文の file パートに載る */
  partType: string;
}

/** 更新でも新規作成でも、「結局どの種別で送ったか」を1つにまとめて見る */
function effectiveType(s: Sent): string {
  return s.contentType || s.partType;
}

/** findFile が既存を返すかどうか。更新経路と新規作成経路を撃ち分ける */
let fileExists = false;

let sent: Sent[];
let files: { id: string; name: string }[];

/** localStorage と fetch を差し替え、接続済みの保存先を1つ作る */
async function connectedTarget(): Promise<GdriveBackupTarget> {
  const t = new GdriveBackupTarget();
  await t.connect();
  sent = []; // 接続時のやり取りは数えない
  return t;
}

beforeEach(() => {
  sent = [];
  files = [];
  fileExists = false;
  const data = new Map<string, string>([
    ["worklist3.gdrive.clientId", "test-client-id"],
    ["worklist3.gdrive.group", "private"],
    // 期限内のトークンを置いておくと、GIS を読まずに通る
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

  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    let partType = "";
    if (init.body instanceof FormData) {
      const part = init.body.get("file");
      if (part instanceof Blob) partType = part.type;
    }
    sent.push({ url, method, contentType: headers["Content-Type"] ?? "", partType });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    const q = decodeURIComponent(url);
    // フォルダの解決(名前で探す → 無ければ作る)
    if (q.includes("google-apps.folder")) return json({ files: [{ id: "folder" }] });
    // 名前で1件探す(findFile)。既存を返すかどうかでアップロードの経路が変わる
    if (method === "GET" && q.includes("name='")) {
      return json({ files: fileExists ? [{ id: "existing" }] : [] });
    }
    // 一覧(ページ送りを再現する)
    if (method === "GET" && url.includes("nextPageToken")) {
      const page2 = url.includes("pageToken=");
      return json(
        page2
          ? { files: files.slice(2) }
          : { files: files.slice(0, 2), nextPageToken: "NEXT" }
      );
    }
    if (method === "GET") return json({ files: [] });
    return json({ id: "new-file" });
  };
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

describe("救出・引継前の書き出し(#124 D)", () => {
  it("圧縮した救出ファイルは application/gzip で送る", async () => {
    const t = await connectedTarget();
    t.compress = true;
    await t.writeSideFile({ count: 1, toJson: () => '[{"id":"a"}]' }, "救出", "1f2336abcd", "20260906-1003");
    const upload = sent.find((s) => s.url.includes("/upload/"));
    expect(upload).toBeDefined();
    // ここが application/octet-stream に戻ると、Drive 上でグレーアウトして
    // 手でダウンロードできなくなる(#124 の症状そのもの)
    expect(effectiveType(upload!)).toBe("application/gzip");
  });

  it("圧縮しない設定なら application/json で送る", async () => {
    const t = await connectedTarget();
    t.compress = false;
    await t.writeSideFile({ count: 1, toJson: () => '[{"id":"a"}]' }, "引継前", "3834aeffff", "20260906-1003");
    const upload = sent.find((s) => s.url.includes("/upload/"));
    expect(effectiveType(upload!)).toBe("application/json");
  });

  it("既存を上書きするとき(PATCH)も application/gzip で送る", async () => {
    fileExists = true;
    const t = await connectedTarget();
    t.compress = true;
    await t.writeSideFile({ count: 1, toJson: () => '[{"id":"a"}]' }, "救出", "1f2336abcd", "20260906-1003");
    const upload = sent.find((s) => s.url.includes("/upload/"));
    expect(upload!.method).toBe("PATCH");
    expect(effectiveType(upload!)).toBe("application/gzip");
  });

  it("ミラーも同じ種別で送る(救出だけ違う、という状態に戻さない)", async () => {
    const t = await connectedTarget();
    t.compress = true;
    await t.writeMirror({ count: 1, toJson: () => '[{"id":"a"}]' });
    const upload = sent.find((s) => s.url.includes("/upload/"));
    expect(effectiveType(upload!)).toBe("application/gzip");
  });
});

describe("一覧のページ送り(#124 E)", () => {
  it("1ページに収まらない救出ファイルも全部拾う", async () => {
    files = [
      { id: "1", name: "worklist3-private-救出-1f2336-20260906-1003.json.gz" },
      { id: "2", name: "worklist3-private-引継前-3834ae-20260906-1004.json.gz" },
      // 2件目までが1ページ目。ここから先は nextPageToken を辿らないと取れない
      { id: "3", name: "worklist3-private-救出-6c31df-20260913-0900.json.gz" },
      { id: "4", name: "worklist3-private.json.gz" }, // ミラーは対象外
    ];
    const t = await connectedTarget();
    const list = await t.listSideFiles();
    expect(list.map((e) => e.key)).toEqual(["1", "2", "3"]);
    expect(sent.filter((s) => s.url.includes("nextPageToken")).length).toBe(2); // 2ページ取った
  });
});
