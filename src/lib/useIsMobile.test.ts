// ==============================================================
// モバイル表示の判定と、URLクエリでの強制指定のテスト
// ==============================================================
import { describe, it, expect, afterEach } from "vitest";
import { shouldUseMobile } from "./useIsMobile";
import { readUrlSettings, writeUrlSettings } from "./urlParams";

describe("shouldUseMobile(幅と強制指定から表示を決める)", () => {
  it("強制指定が無ければ画面幅に従う", () => {
    expect(shouldUseMobile(true, undefined)).toBe(true);
    expect(shouldUseMobile(false, undefined)).toBe(false);
  });

  it("mobile を強制すれば広い画面でもモバイル", () => {
    expect(shouldUseMobile(false, "mobile")).toBe(true);
  });

  it("desktop を強制すれば狭い画面でもデスクトップ", () => {
    expect(shouldUseMobile(true, "desktop")).toBe(false);
  });
});

// -------------------------------------------------------------
// URLクエリ。window を差し替えて読み書きを確かめる
// -------------------------------------------------------------
interface FakeWindow {
  location: { search: string; pathname: string };
  history: { replaceState: (a: null, b: string, url: string) => void };
}

function withUrl(search: string): { written: () => string } {
  let url = "";
  const fake: FakeWindow = {
    location: { search, pathname: "/worklist3/" },
    history: { replaceState: (_a, _b, u) => { url = u; } },
  };
  (globalThis as unknown as { window: FakeWindow }).window = fake;
  return { written: () => url };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: FakeWindow }).window;
});

const base = {
  mode: "all" as const,
  view: "todayOnward" as const,
  done: "all" as const,
  planned: false,
  category: "",
  q: "",
  from: "",
  to: "",
};

describe("readUrlSettings の ui", () => {
  it("?ui=mobile を読む", () => {
    withUrl("?ui=mobile");
    expect(readUrlSettings().ui).toBe("mobile");
  });

  it("?ui=desktop を読む", () => {
    withUrl("?ui=desktop");
    expect(readUrlSettings().ui).toBe("desktop");
  });

  it("?ui=auto は自動(undefined)として扱う", () => {
    withUrl("?ui=auto");
    expect(readUrlSettings().ui).toBeUndefined();
  });

  it("不正な値は自動として扱う", () => {
    withUrl("?ui=phone");
    expect(readUrlSettings().ui).toBeUndefined();
  });

  it("指定が無ければ自動", () => {
    withUrl("");
    expect(readUrlSettings().ui).toBeUndefined();
  });
});

describe("writeUrlSettings の ui", () => {
  it("強制しているときだけ ui を書く", () => {
    const w = withUrl("");
    writeUrlSettings({ ...base, ui: "mobile" });
    expect(w.written()).toContain("ui=mobile");
  });

  it("自動のときは ui を書かない(スマホで作ったURLをPCで開いても強制されない)", () => {
    const w = withUrl("");
    writeUrlSettings({ ...base, ui: undefined });
    expect(w.written()).not.toContain("ui=");
  });

  it("書いたURLを読み戻すと同じ強制指定になる", () => {
    const w = withUrl("");
    writeUrlSettings({ ...base, ui: "desktop" });
    withUrl(w.written());
    expect(readUrlSettings().ui).toBe("desktop");
  });
});
