// ==============================================================
// migrateTask がカレンダー連携フィールドを壊さないことの確認
// ==============================================================
import { describe, it, expect } from "vitest";
import { migrateTask } from "./storage";

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
