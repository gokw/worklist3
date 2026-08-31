// ==============================================================
// parseLink の単体テスト(Issue #45)
// ==============================================================
import { describe, it, expect } from "vitest";
import { isMapsUrl, linkIcon, parseLink } from "./link";

describe("parseLink: Webリンク", () => {
  it("https はそのまま web 扱い", () => {
    const r = parseLink("https://example.com/a?b=1");
    expect(r.kind).toBe("web");
    expect(r.value).toBe("https://example.com/a?b=1");
  });
  it("前後の空白はトリムする", () => {
    expect(parseLink("  https://example.com  ").value).toBe("https://example.com");
  });
});

describe("parseLink: ローカルパス", () => {
  it("ドライブパス(フォルダ)はネイティブのまま・フォルダ判定", () => {
    const r = parseLink("F:\\ripping\\web\\新しいフォルダー");
    expect(r.kind).toBe("local");
    expect(r.value).toBe("F:\\ripping\\web\\新しいフォルダー");
    expect(r.isFile).toBe(false);
  });

  it("引用符囲みのファイルパスは引用符を外し・ファイル判定", () => {
    const r = parseLink('"F:\\ripping\\web\\新しいフォルダー\\動画.mp4"');
    expect(r.kind).toBe("local");
    expect(r.value).toBe("F:\\ripping\\web\\新しいフォルダー\\動画.mp4");
    expect(r.isFile).toBe(true);
  });

  it("スラッシュ区切りのドライブパスはバックスラッシュへ統一", () => {
    const r = parseLink("F:/ripping/web/a.txt");
    expect(r.value).toBe("F:\\ripping\\web\\a.txt");
    expect(r.isFile).toBe(true);
  });

  it("file:/// URI はネイティブパスへ(パーセントデコードも)", () => {
    const r = parseLink("file:///F:/ripping/web/a%20b/c.mp4");
    expect(r.value).toBe("F:\\ripping\\web\\a b\\c.mp4");
    expect(r.isFile).toBe(true);
  });

  it("UNC パスはそのまま・フォルダ判定", () => {
    const r = parseLink("\\\\server\\share\\dir");
    expect(r.kind).toBe("local");
    expect(r.value).toBe("\\\\server\\share\\dir");
    expect(r.isFile).toBe(false);
  });

  it("末尾がスラッシュのフォルダはファイル扱いにしない", () => {
    expect(parseLink("F:\\a\\b\\").isFile).toBe(false);
  });
});

// ==============================================================
// isMapsUrl / linkChip の単体テスト(Issue #88)
// ==============================================================
describe("isMapsUrl", () => {
  it("#86 が作る共有URLは地図と判定する", () => {
    expect(isMapsUrl("https://www.google.com/maps/search/?api=1&query=35.681236,139.767125")).toBe(
      true
    );
  });
  it("maps.google.co.jp は地図", () => {
    expect(isMapsUrl("https://maps.google.co.jp/maps?q=1,2")).toBe(true);
  });
  it("google.co.jp/maps は地図", () => {
    expect(isMapsUrl("https://google.co.jp/maps/place/Tokyo")).toBe(true);
  });
  it("共有短縮URL(maps.app.goo.gl)は地図", () => {
    expect(isMapsUrl("https://maps.app.goo.gl/abcd1234")).toBe(true);
  });
  it("旧共有短縮URL(goo.gl/maps)は地図", () => {
    expect(isMapsUrl("https://goo.gl/maps/abcd")).toBe(true);
  });
  it("Google でも maps 以外のパスは地図ではない", () => {
    expect(isMapsUrl("https://www.google.com/search?q=maps")).toBe(false);
  });
  it("ホスト名以外に maps を含むだけの他サイトは地図ではない", () => {
    expect(isMapsUrl("https://example.com/maps/google")).toBe(false);
  });
  it("URLとして読めない文字列は地図ではない", () => {
    expect(isMapsUrl("F:\\maps\\a.png")).toBe(false);
    expect(isMapsUrl("")).toBe(false);
  });
});

describe("linkIcon", () => {
  it("地図リンクは 🗺️", () => {
    expect(linkIcon(parseLink("https://www.google.com/maps/search/?api=1&query=35.6,139.7"))).toBe(
      "\u{1F5FA}\u{FE0F}"
    );
  });
  it("その他の Web リンクは 🔗", () => {
    expect(linkIcon(parseLink("https://www.example.com/very/long/path?a=1"))).toBe("\u{1F517}");
    expect(linkIcon(parseLink("mailto:a@example.com"))).toBe("\u{1F517}");
  });
  it("ローカルのファイルは 📄", () => {
    expect(linkIcon(parseLink('"F:\\ripping\\web\\動画.mp4"'))).toBe("\u{1F4C4}");
  });
  it("ローカルのフォルダは 📁(末尾区切りでもフォルダ)", () => {
    expect(linkIcon(parseLink("F:\\ripping\\web\\新しいフォルダー\\"))).toBe("\u{1F4C1}");
    expect(linkIcon(parseLink("\\\\server\\share\\資料"))).toBe("\u{1F4C1}");
  });
});
