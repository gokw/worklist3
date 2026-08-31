// ==============================================================
// 手番の純粋ロジックの単体テスト(Issue #91)
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  absoluteTime,
  canWrite,
  ownerLabel,
  relativeTime,
  rescueStamp,
  resolveRole,
  staleWarning,
} from "./baton";
import { rescueFileName, dailyFileDate } from "./backupTargets/types";

const owner = (deviceId: string) => ({ deviceId, deviceName: "自宅PC", since: "2026-08-31T09:00:00Z" });

describe("resolveRole", () => {
  it("自分のIDと一致すれば手番あり", () => {
    expect(resolveRole(owner("me"), "me")).toBe("owner");
  });
  it("違うIDなら手番なし", () => {
    expect(resolveRole(owner("other"), "me")).toBe("guest");
  });
  it("手番ファイルが無ければ未設定", () => {
    expect(resolveRole(null, "me")).toBe("unset");
  });
  it("deviceId が空の壊れた記録は未設定として扱う(読めない値で締め出さない)", () => {
    expect(resolveRole(owner(""), "me")).toBe("unset");
  });
  it("端末名が同じでもIDが違えば手番なし(#91 §3-2の要)", () => {
    const a = { deviceId: "id-a", deviceName: "PC", since: "" };
    expect(resolveRole(a, "id-b")).toBe("guest");
  });
});

describe("canWrite", () => {
  it("手番制OFFなら常に書ける(従来どおり)", () => {
    expect(canWrite(false, "guest")).toBe(true);
    expect(canWrite(false, "unset")).toBe(true);
  });
  it("手番制ONで手番なしのときだけ書けない", () => {
    expect(canWrite(true, "guest")).toBe(false);
    expect(canWrite(true, "owner")).toBe(true);
    expect(canWrite(true, "unset")).toBe(true);
  });
});

describe("ownerLabel", () => {
  it("端末名は任意入力なので、空なら代替表示にする", () => {
    expect(ownerLabel("")).toBe("別の端末");
    expect(ownerLabel("   ")).toBe("別の端末");
    expect(ownerLabel("スマホ")).toBe("スマホ");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  it("分・時間・日で丸める", () => {
    expect(relativeTime("2026-08-31T11:57:00Z", now)).toBe("3分前");
    expect(relativeTime("2026-08-31T06:00:00Z", now)).toBe("6時間前");
    expect(relativeTime("2026-08-29T12:00:00Z", now)).toBe("2日前");
  });
  it("1分未満と未来を潰す(端末の時計ずれでマイナスになり得る)", () => {
    expect(relativeTime("2026-08-31T11:59:30Z", now)).toBe("1分未満前");
    expect(relativeTime("2026-08-31T12:05:00Z", now)).toBe("たった今");
  });
  it("読めない値は空", () => {
    expect(relativeTime("", now)).toBe("");
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});

describe("absoluteTime", () => {
  it("読めない値は空(相対表示と併記するため、壊れても落とさない)", () => {
    expect(absoluteTime("nope")).toBe("");
  });
  it("整形して返す", () => {
    expect(absoluteTime("2026-08-31T09:12:00")).toBe("2026/08/31 09:12");
  });
});

describe("staleWarning", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  it("直近のバックアップなら警告しない", () => {
    expect(staleWarning("2026-08-31T11:55:00Z", now, "自宅PC")).toBe("");
  });
  it("古ければ未送信の可能性を述べる", () => {
    const w = staleWarning("2026-08-31T06:00:00Z", now, "自宅PC");
    expect(w).toContain("自宅PC");
    expect(w).toContain("6時間前");
    expect(w).toContain("失われます");
  });
  it("端末名が空でも文章が成立する", () => {
    expect(staleWarning("2026-08-31T06:00:00Z", now, "")).toContain("別の端末");
  });
  it("時刻が読めなければ警告しない(奪取は妨げない)", () => {
    expect(staleWarning("", now, "自宅PC")).toBe("");
  });
});

describe("rescueFileName", () => {
  it("ローテーション掃除に巻き込まれない名前であること(消えては困る)", () => {
    const stamp = rescueStamp(new Date("2026-08-31T14:30:00"));
    const name = rescueFileName("worklist3-わたし", "9f2c8a1e-1111", stamp, true);
    expect(name).toBe("worklist3-わたし-救出-9f2c8a-20260831-1430.json.gz");
    // 日次コピーとして解釈されない = 掃除の対象にならない
    expect(dailyFileDate("worklist3-わたし", name)).toBeNull();
  });
  it("非圧縮なら .json", () => {
    const name = rescueFileName("worklist3-x", "abcdef12", "20260831-0900", false);
    expect(name.endsWith(".json")).toBe(true);
  });
  it("端末が違えば別名になる(2台の救出が衝突しない)", () => {
    const a = rescueFileName("p", "aaaaaa11", "20260831-1430", true);
    const b = rescueFileName("p", "bbbbbb22", "20260831-1430", true);
    expect(a).not.toBe(b);
  });
});
