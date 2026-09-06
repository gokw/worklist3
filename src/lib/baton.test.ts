// ==============================================================
// 手番の純粋ロジックの単体テスト(Issue #91)
// ==============================================================
import { describe, it, expect } from "vitest";
import {
  absoluteTime,
  canPersist,
  canWrite,
  enableAction,
  formatStamp,
  keepWarning,
  ownerLabel,
  relativeTime,
  rescueStamp,
  resolveRole,
  staleWarning,
} from "./baton";
import { sideFileInfo, sideFileName, dailyFileDate } from "./backupTargets/types";

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

describe("sideFileName / sideFileInfo(退避・救出の命名)", () => {
  it("ローテーション掃除に巻き込まれない名前であること(消えては困る)", () => {
    const stamp = rescueStamp(new Date("2026-08-31T14:30:00"));
    const name = sideFileName("worklist3-わたし", "救出", "9f2c8a1e-1111", stamp, true);
    expect(name).toBe("worklist3-わたし-救出-9f2c8a-20260831-1430.json.gz");
    // 日次コピーとして解釈されない = 掃除の対象にならない
    expect(dailyFileDate("worklist3-わたし", name)).toBeNull();
  });

  it("引継前も同じ規約で名付く(#109)", () => {
    const name = sideFileName("worklist3-x", "引継前", "abcdef12", "20260906-0915", true);
    expect(name).toBe("worklist3-x-引継前-abcdef-20260906-0915.json.gz");
  });

  it("非圧縮なら .json", () => {
    const name = sideFileName("worklist3-x", "救出", "abcdef12", "20260831-0900", false);
    expect(name.endsWith(".json")).toBe(true);
  });

  it("端末が違えば別名になる(2台の救出が衝突しない)", () => {
    const a = sideFileName("p", "救出", "aaaaaa11", "20260831-1430", true);
    const b = sideFileName("p", "救出", "bbbbbb22", "20260831-1430", true);
    expect(a).not.toBe(b);
  });

  // 書き出しと一覧で規約が食い違うと、書けているのに読み戻せない(#109 の穴)
  it("書いた名前を読み戻せる(書き出し側と一覧側で規約が一致している)", () => {
    for (const kind of ["救出", "引継前"] as const) {
      for (const compress of [true, false]) {
        const name = sideFileName("worklist3-わたし", kind, "9f2c8a", "20260906-0915", compress);
        expect(sideFileInfo("worklist3-わたし", name)).toEqual({
          kind,
          stamp: "20260906-0915",
        });
      }
    }
  });

  it("規約外の名前は拾わない(ミラー・日次を巻き込まない)", () => {
    expect(sideFileInfo("worklist3-x", "worklist3-x.json")).toBeNull();
    expect(sideFileInfo("worklist3-x", "worklist3-x-2026-09-06.json")).toBeNull();
    expect(sideFileInfo("worklist3-x", "worklist3-x-救出-9f2c8a.json")).toBeNull();
    expect(sideFileInfo("worklist3-x", "worklist3-y-救出-9f2c8a-20260906-0915.json")).toBeNull();
  });
});

describe("enableAction", () => {
  it("誰も手番を持っていなければ、この端末が取る", () => {
    expect(enableAction("unset")).toBe("claim");
  });
  it("すでに自分が手番なら何もしない", () => {
    expect(enableAction("owner")).toBe("noop");
  });
  it("他の端末が手番を持っていたら奪わず、バナーへ誘導する", () => {
    // ここで claim すると、相手のデータを読まずに手番だけ奪うことになる。
    // 仕様書 §4.5 が禁じた「②③を通らずに④だけ起きる経路」そのもの
    expect(enableAction("guest")).toBe("banner");
  });
});

// #109: 保存してよいかの判定はここ1か所。閲覧中は絶対に書かない
describe("canPersist(保存してよいか)", () => {
  const base = { viewing: false, isPrimary: true, enabled: true, role: "owner" as const };

  it("手番があり、書き手の窓で、閲覧中でなければ書く", () => {
    expect(canPersist(base)).toBe(true);
  });

  it("閲覧中は、他の条件が何であっても書かない", () => {
    for (const isPrimary of [true, false]) {
      for (const enabled of [true, false]) {
        for (const role of ["owner", "guest", "unset"] as const) {
          expect(canPersist({ viewing: true, isPrimary, enabled, role })).toBe(false);
        }
      }
    }
  });

  it("読み取り専用の窓では書かない(#57)", () => {
    expect(canPersist({ ...base, isPrimary: false })).toBe(false);
  });

  it("手番の無い端末では書かない(#91)", () => {
    expect(canPersist({ ...base, role: "guest" })).toBe(false);
  });

  it("手番制OFFなら手番の立場は問わない", () => {
    expect(canPersist({ ...base, enabled: false, role: "guest" })).toBe(true);
  });
});

// #109 §4.3: 上書きで消える差分を、数で見せる
describe("keepWarning(手元のまま引き継ぐ)", () => {
  it("相手の方が多ければ、その差を知らせる", () => {
    expect(keepWarning(431, 428)).toContain("3 件");
  });

  it("件数が確認できないときは、その旨を知らせる", () => {
    expect(keepWarning(null, 428)).toContain("確認できません");
  });

  it("手元の方が多い/同じなら特筆しない", () => {
    expect(keepWarning(400, 428)).toBe("");
    expect(keepWarning(428, 428)).toBe("");
  });
});

describe("formatStamp", () => {
  it("退避ファイルの時刻を読みやすくする", () => {
    expect(formatStamp("20260906-0915")).toBe("2026/09/06 09:15");
  });
  it("規約外はそのまま返す", () => {
    expect(formatStamp("なにか")).toBe("なにか");
  });
});
