import { afterEach, describe, expect, it } from "vitest";
import { NO_CATEGORY } from "./logic";
import { parseStartupAction, readUrlSettings, writeUrlSettings } from "./urlParams";

// 起動時の操作(#105)。ブックマークから直接「ここにいる」記録を開くための入口。
describe("parseStartupAction", () => {
  it("action=here を読む", () => {
    expect(parseStartupAction("?action=here")).toBe("here");
    expect(parseStartupAction("?mode=personal&action=here")).toBe("here");
  });

  it("指定が無ければ undefined", () => {
    expect(parseStartupAction("")).toBeUndefined();
    expect(parseStartupAction("?mode=personal")).toBeUndefined();
  });

  it("知らない値は無視する(勝手に何かを開かない)", () => {
    expect(parseStartupAction("?action=")).toBeUndefined();
    expect(parseStartupAction("?action=delete")).toBeUndefined();
    expect(parseStartupAction("?action=HERE")).toBeUndefined();
  });
});

// -------------------------------------------------------------
// ショートカット/ブックマークのURL(#117)
//
//   「ここにいる記録」は action=here で開くが、一覧をどの期間で出すかは
//   view で別に指定する。**この2つは読む経路が別々で、併用できる**。
//   manifest のショートカットが ?action=here&view=today に依存しているので、
//   どちらか片方しか効かなくなる変更をここで止める。
// -------------------------------------------------------------
interface FakeWindow {
  location: { search: string };
}

function withUrl(search: string) {
  (globalThis as unknown as { window: FakeWindow }).window = { location: { search } };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: FakeWindow }).window;
});

describe("action と表示指定の併用(#117)", () => {
  it("?action=here&view=today は、記録ダイアログと「今日」の両方が効く", () => {
    const search = "?action=here&view=today";
    withUrl(search);
    expect(parseStartupAction(search)).toBe("here");
    expect(readUrlSettings().view).toBe("today");
  });

  it("view を付けても action の読み取りは変わらない", () => {
    expect(parseStartupAction("?action=here&view=everything")).toBe("here");
    expect(parseStartupAction("?view=today&action=here")).toBe("here");
  });

  it("action だけなら view は未指定(アプリ側の既定=今日以降になる)", () => {
    withUrl("?action=here");
    expect(readUrlSettings().view).toBeUndefined();
  });

  it("知らない view は無視する(action だけが効く)", () => {
    withUrl("?action=here&view=tomorrow");
    expect(parseStartupAction("?action=here&view=tomorrow")).toBe("here");
    expect(readUrlSettings().view).toBeUndefined();
  });
});

// カテゴリ未設定の絞り込み(#137)。値の無い category= で表す
describe("category=(未設定)の読み書き", () => {
  const base = {
    mode: "all" as const,
    view: "today" as const,
    done: "all" as const,
    planned: false,
    q: "",
    from: "",
    to: "",
    ui: undefined,
  };

  function written(category: string): URLSearchParams {
    let url = "";
    (globalThis as unknown as { window: unknown }).window = {
      location: { search: "", pathname: "/" },
      history: { replaceState: (_s: unknown, _t: string, u: string) => (url = u) },
    };
    writeUrlSettings({ ...base, category });
    return new URLSearchParams(url.replace(/^\//, ""));
  }

  it("値の無い category= は未設定として読む", () => {
    withUrl("?category=");
    expect(readUrlSettings().category).toBe(NO_CATEGORY);
  });

  it("名前があればそのカテゴリ、無ければ未指定", () => {
    withUrl("?category=%E9%81%8B%E7%94%A8");
    expect(readUrlSettings().category).toBe("運用");
    withUrl("?view=today");
    expect(readUrlSettings().category).toBeUndefined();
  });

  it("未設定は値の無い category= で書き、全カテゴリは書かない", () => {
    expect(written(NO_CATEGORY).get("category")).toBe("");
    expect(written("").has("category")).toBe(false);
    expect(written("運用").get("category")).toBe("運用");
  });
});
