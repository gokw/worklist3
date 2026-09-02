// ==============================================================
// トークンの期限判定と保存値の読み戻しのテスト(#96)
//   GIS・ネットワークに触らない純粋部分だけを検証する。
//   ここが守るのは「失効間際のトークンを使って書き込みに失敗しない」
//   「壊れた保存値で接続状態を誤認しない」の2点。
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  RENEW_BEFORE_MS,
  parseStoredToken,
  tokenAlive,
  tokenExpiresAt,
  tokenNearExpiry,
} from "./googleAuth";

const NOW = 1_756_000_000_000; // 適当な固定時刻(ms)

describe("tokenExpiresAt(失効時刻の決定)", () => {
  it("expires_in から余裕(60秒)を引いた時刻になる", () => {
    // 3600秒もらったら、3540秒後には失効扱いにする
    expect(tokenExpiresAt(NOW, 3600)).toBe(NOW + 3540 * 1000);
  });

  it("expires_in が無ければ既定の約1時間を仮定する", () => {
    expect(tokenExpiresAt(NOW, undefined)).toBe(NOW + 3540 * 1000);
  });

  it("短命なトークンでも余裕のぶん手前で失効扱いになる", () => {
    expect(tokenExpiresAt(NOW, 120)).toBe(NOW + 60 * 1000);
  });
});

describe("tokenAlive / tokenNearExpiry", () => {
  it("期限内は生きている", () => {
    expect(tokenAlive(NOW + 1000, NOW)).toBe(true);
  });

  it("期限ちょうど・超過は失効(境界)", () => {
    expect(tokenAlive(NOW, NOW)).toBe(false);
    expect(tokenAlive(NOW - 1, NOW)).toBe(false);
  });

  it("残り10分を切ったら取り直し時期(境界)", () => {
    expect(tokenNearExpiry(NOW + RENEW_BEFORE_MS, NOW)).toBe(false);
    expect(tokenNearExpiry(NOW + RENEW_BEFORE_MS - 1, NOW)).toBe(true);
  });

  it("失効済みも「取り直し時期」に含まれる", () => {
    expect(tokenNearExpiry(NOW - 1000, NOW)).toBe(true);
  });
});

describe("parseStoredToken(保存値の読み戻し)", () => {
  const valid = JSON.stringify({
    token: "ya29.example",
    expiresAt: NOW + 30 * 60_000,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  it("期限内の保存値はそのまま返す", () => {
    const t = parseStoredToken(valid, NOW);
    expect(t?.token).toBe("ya29.example");
    expect(t?.scopes).toEqual(["https://www.googleapis.com/auth/drive.file"]);
  });

  it("無い・期限切れ・壊れた値は null(=保存が無いのと同じ扱いで落ちない)", () => {
    expect(parseStoredToken(null, NOW)).toBeNull();
    const expired = JSON.stringify({ token: "t", expiresAt: NOW - 1, scopes: [] });
    expect(parseStoredToken(expired, NOW)).toBeNull();
    for (const raw of [
      "",
      "{",
      "null",
      "[]",
      JSON.stringify({ token: "", expiresAt: NOW + 1000 }), // 空トークン
      JSON.stringify({ token: "t" }), // 期限なし
      JSON.stringify({ token: 123, expiresAt: NOW + 1000 }), // 型違い
    ]) {
      expect(parseStoredToken(raw, NOW)).toBeNull();
    }
  });

  it("scopes が壊れていても、トークン自体が有効なら文字列だけ拾って返す", () => {
    // scope 情報は「欠けていると断じられるときだけ」使う補助情報なので、
    // 壊れていてもトークンを捨てる理由にはしない
    const raw = JSON.stringify({ token: "t", expiresAt: NOW + 1000, scopes: ["a", 1, null] });
    expect(parseStoredToken(raw, NOW)?.scopes).toEqual(["a"]);
    const noScopes = JSON.stringify({ token: "t", expiresAt: NOW + 1000 });
    expect(parseStoredToken(noScopes, NOW)?.scopes).toEqual([]);
  });
});
