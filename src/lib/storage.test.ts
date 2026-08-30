// ==============================================================
// migrateTask がカレンダー連携フィールドを壊さないことの確認
// ==============================================================
import { describe, it, expect } from "vitest";
import { migrateTask, serializeTasks } from "./storage";
import { decodeBackupBytes, gzipText } from "./gzip";

describe("migrateTask と gcalEventId", () => {
  it("既存の gcalEventId を保持する", () => {
    const t = migrateTask({
      id: "a",
      title: "会議",
      scope: "work",
      importance: "C",
      estimateMin: 30,
      memos: ["", "", ""],
      links: [],
      waiting: false,
      gcalEventId: "ev-123",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(t.gcalEventId).toBe("ev-123");
  });

  it("未設定(旧データ)は undefined のまま許容する", () => {
    const t = migrateTask({ id: "a", title: "会議" });
    expect(t.gcalEventId).toBeUndefined();
  });
});

describe("serializeTasks の整形指定", () => {
  const tasks = [migrateTask({ id: "a", title: "会議" })];

  it("既定は整形あり(人が読める・そのままインポートできる)", () => {
    expect(serializeTasks(tasks)).toContain("\n");
  });

  it("整形なしを選べる(圧縮して保管するとき用)", () => {
    const compact = serializeTasks(tasks, false);
    expect(compact).not.toContain("\n");
    // 整形の有無で中身は変わらない
    expect(JSON.parse(compact)).toEqual(JSON.parse(serializeTasks(tasks)));
  });
});

describe("圧縮して書き出した控えを読み戻せる", () => {
  const tasks = [
    migrateTask({ id: "a", title: "【来客】Saviynt【応接室0415】", memos: ["一行目\n二行目"] }),
    migrateTask({ id: "b", title: "週次定例", gcalEventId: "ev-1" }),
  ];

  it("整形なし→gzip→展開→パース→migrate で元に戻る", async () => {
    const gz = await gzipText(serializeTasks(tasks, false));
    const back = JSON.parse(await decodeBackupBytes(gz)).map(migrateTask);
    expect(back).toEqual(tasks);
  });

  it("非圧縮の控えも同じ経路で読める(拡張子ではなく中身で判別するため)", async () => {
    const bytes = new TextEncoder().encode(serializeTasks(tasks));
    const back = JSON.parse(await decodeBackupBytes(bytes)).map(migrateTask);
    expect(back).toEqual(tasks);
  });
});
