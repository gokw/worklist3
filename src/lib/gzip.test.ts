// ==============================================================
// gzip 圧縮・展開・判定のテスト
//   バックアップの控えが「書けたのに読み戻せない」状態にならないことを守る。
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  decodeBackupBytes,
  gunzipText,
  gzipSupported,
  gzipText,
  looksGzipped,
  verifyGzipped,
} from "./gzip";

/** テスト用に、実データに近い形のタスク配列を作る */
function sampleTasks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    title: `週次定例 ${i}`,
    scope: "work",
    category: "運用業務",
    importance: "C",
    waiting: false,
    date: "2026-08-30",
    estimateMin: 30,
    memos: ["確認事項をまとめておくこと", "", ""],
    links: [],
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  }));
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("gzip の可用性", () => {
  it("テスト環境(Node)で gzip が使える", () => {
    expect(gzipSupported).toBe(true);
  });
});

describe("looksGzipped", () => {
  it("gzip の先頭2バイト(1F 8B)を見て判定する", async () => {
    expect(looksGzipped(await gzipText("[]"))).toBe(true);
  });

  it("素のJSONは gzip と判定しない", () => {
    expect(looksGzipped(enc('[{"id":"a"}]'))).toBe(false);
  });

  it("2バイト未満でも落ちない", () => {
    expect(looksGzipped(new Uint8Array([0x1f]))).toBe(false);
    expect(looksGzipped(new Uint8Array([]))).toBe(false);
  });
});

describe("圧縮と展開のラウンドトリップ", () => {
  it("元の文字列に戻る", async () => {
    const json = JSON.stringify(sampleTasks(50));
    expect(await gunzipText(await gzipText(json))).toBe(json);
  });

  it("日本語・改行を含むメモが壊れない", async () => {
    const json = JSON.stringify([{ memos: ["一行目\n二行目\t三行目", "【来客】応接室0415", ""] }]);
    expect(await gunzipText(await gzipText(json))).toBe(json);
  });

  it("空配列でも往復できる", async () => {
    expect(await gunzipText(await gzipText("[]"))).toBe("[]");
  });

  it("実データ相当のサイズがきちんと縮む", async () => {
    const json = JSON.stringify(sampleTasks(1000));
    const gz = await gzipText(json);
    // 同形レコードの JSON なので大きく縮む。回帰で圧縮が外れたら気づけるようにする
    expect(gz.length).toBeLessThan(enc(json).length / 5);
  });
});

describe("decodeBackupBytes(拡張子ではなく中身で判定)", () => {
  it("圧縮されていれば展開して返す", async () => {
    const json = JSON.stringify(sampleTasks(3));
    expect(await decodeBackupBytes(await gzipText(json))).toBe(json);
  });

  it("素のJSONはそのまま返す", async () => {
    const json = JSON.stringify(sampleTasks(3));
    expect(await decodeBackupBytes(enc(json))).toBe(json);
  });

  it("整形済み(インデント付き)のJSONもそのまま返す", async () => {
    const json = JSON.stringify(sampleTasks(2), null, 2);
    expect(await decodeBackupBytes(enc(json))).toBe(json);
  });
});

describe("verifyGzipped(書き込み前の検証)", () => {
  it("正しく圧縮できていれば問題なしを返す", async () => {
    const tasks = sampleTasks(10);
    const gz = await gzipText(JSON.stringify(tasks));
    expect(await verifyGzipped(gz, 10)).toBe("");
  });

  it("件数が食い違えば理由を返す", async () => {
    const gz = await gzipText(JSON.stringify(sampleTasks(9)));
    expect(await verifyGzipped(gz, 10)).toContain("件数が合いません");
  });

  it("壊れたデータは展開できないと報告する", async () => {
    const gz = await gzipText(JSON.stringify(sampleTasks(5)));
    gz[gz.length - 5] ^= 0xff; // 末尾付近を破壊する
    expect(await verifyGzipped(gz, 5)).not.toBe("");
  });

  it("gzip でないものを渡されたら展開失敗として報告する", async () => {
    expect(await verifyGzipped(enc("[]"), 0)).toContain("展開できませんでした");
  });

  it("JSONでない中身は理由を返す", async () => {
    const gz = await gzipText("これはJSONではない");
    expect(await verifyGzipped(gz, 0)).toContain("JSONとして読めませんでした");
  });

  it("配列でない中身は理由を返す", async () => {
    const gz = await gzipText('{"tasks":[]}');
    expect(await verifyGzipped(gz, 0)).toContain("配列ではありません");
  });
});
