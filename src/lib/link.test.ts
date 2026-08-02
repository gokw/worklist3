// ==============================================================
// parseLink の単体テスト(Issue #45)
// ==============================================================
import { describe, it, expect } from "vitest";
import { parseLink } from "./link";

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
