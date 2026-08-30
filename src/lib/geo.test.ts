// ==============================================================
// 「ここにいる」記録の純粋ロジックのテスト(Issue #86)
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  formatAccuracy,
  formatCoords,
  geoErrorMessage,
  locationMemo,
  mapsUrl,
  resolveTitle,
} from "./geo";

const p = { lat: 35.7100627, lng: 139.8107004, accuracy: 18.4 };

describe("formatCoords", () => {
  it("小数6桁に揃える(GPSの誤差より細かいので十分)", () => {
    expect(formatCoords(p.lat, p.lng)).toBe("35.710063, 139.810700");
  });

  it("南半球・西経(負の値)も扱える", () => {
    expect(formatCoords(-33.8688, -151.2093)).toBe("-33.868800, -151.209300");
  });

  it("0でも桁を落とさない", () => {
    expect(formatCoords(0, 0)).toBe("0.000000, 0.000000");
  });
});

describe("formatAccuracy", () => {
  it("メートルで丸めて表示する", () => {
    expect(formatAccuracy(18.4)).toBe("±18m");
  });

  it("取れないときは空にする(かっこだけ残さない)", () => {
    expect(formatAccuracy(undefined)).toBe("");
    expect(formatAccuracy(0)).toBe("");
    expect(formatAccuracy(NaN)).toBe("");
    expect(formatAccuracy(-5)).toBe("");
  });
});

describe("mapsUrl", () => {
  it("APIキー不要の検索URLを作る", () => {
    expect(mapsUrl(p.lat, p.lng)).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.7100627,139.8107004"
    );
  });

  it("web リンクとして扱える形になっている", () => {
    expect(mapsUrl(p.lat, p.lng).startsWith("https://")).toBe(true);
  });
});

describe("locationMemo", () => {
  it("座標と精度を残す", () => {
    expect(locationMemo(p)).toBe("35.710063, 139.810700 (±18m)");
  });

  it("精度が無ければ座標だけ", () => {
    expect(locationMemo({ lat: p.lat, lng: p.lng })).toBe("35.710063, 139.810700");
  });
});

describe("resolveTitle", () => {
  it("入力した場所名に目印を付ける", () => {
    expect(resolveTitle("東京スカイツリー", p)).toBe("📍 東京スカイツリー");
  });

  it("目印を二重に付けない(入力欄の初期値をそのまま活かせる)", () => {
    expect(resolveTitle("📍 東京スカイツリー", p)).toBe("📍 東京スカイツリー");
  });

  it("空なら座標を入れる(名前無しだと一覧で見分けが付かないため)", () => {
    expect(resolveTitle("", p)).toBe("📍 35.710063, 139.810700");
    expect(resolveTitle("   ", p)).toBe("📍 35.710063, 139.810700");
    expect(resolveTitle("📍", p)).toBe("📍 35.710063, 139.810700");
    expect(resolveTitle("📍 ", p)).toBe("📍 35.710063, 139.810700");
  });

  it("前後の空白は落とす", () => {
    expect(resolveTitle("  浅草寺  ", p)).toBe("📍 浅草寺");
  });
});

describe("geoErrorMessage", () => {
  it("拒否・取得不可・タイムアウトを区別する", () => {
    expect(geoErrorMessage(1)).toContain("許可");
    expect(geoErrorMessage(2)).toContain("屋内");
    expect(geoErrorMessage(3)).toContain("時間");
  });

  it("未知のコードでも文言を返す", () => {
    expect(geoErrorMessage(99)).not.toBe("");
  });
});
