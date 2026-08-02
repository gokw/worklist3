// ==============================================================
// gcalMap の単体テスト(ネットワーク・認証なしで振る舞いを固定する)
// ==============================================================
import { describe, it, expect, vi } from "vitest";
import type { Task } from "../types";
import {
  taskToEvent,
  isSyncableTask,
  syncTasksToCalendar,
  type CalendarClient,
  type CalResult,
} from "./gcalMap";

/** テスト用の最小タスク */
function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "会議",
    category: "",
    importance: "C",
    waiting: false,
    date: "2026-07-16",
    planStart: "14:30",
    estimateMin: 60,
    memos: ["", "", ""],
    links: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("taskToEvent(マッピング)", () => {
  it("date + planStart から start.dateTime を作る", () => {
    const e = taskToEvent(mkTask());
    expect(e.start.dateTime).toBe("2026-07-16T14:30:00");
    expect(e.summary).toBe("会議");
  });

  it("estimateMin を加算して end.dateTime を作る", () => {
    const e = taskToEvent(mkTask({ planStart: "14:30", estimateMin: 60 }));
    expect(e.end.dateTime).toBe("2026-07-16T15:30:00");
  });

  it("見積が0なら15分として終了を出す", () => {
    const e = taskToEvent(mkTask({ planStart: "09:00", estimateMin: 0 }));
    expect(e.end.dateTime).toBe("2026-07-16T09:15:00");
  });

  it("見積が未設定でも15分にする", () => {
    const e = taskToEvent(mkTask({ planStart: "09:00", estimateMin: undefined as unknown as number }));
    expect(e.end.dateTime).toBe("2026-07-16T09:15:00");
  });

  it("日跨ぎは翌日の日付で終了を表現する", () => {
    const e = taskToEvent(mkTask({ date: "2026-07-16", planStart: "23:30", estimateMin: 60 }));
    expect(e.end.dateTime).toBe("2026-07-17T00:30:00");
  });

  it("timeZone は Asia/Tokyo", () => {
    const e = taskToEvent(mkTask());
    expect(e.start.timeZone).toBe("Asia/Tokyo");
    expect(e.end.timeZone).toBe("Asia/Tokyo");
  });

  it("description や colorId を含まない(件名・開始・終了だけ)", () => {
    const e = taskToEvent(mkTask({ category: "運用", importance: "S" }));
    expect(Object.keys(e).sort()).toEqual(["end", "start", "summary"]);
    expect(JSON.stringify(e)).not.toContain("description");
    expect(JSON.stringify(e)).not.toContain("colorId");
  });
});

describe("isSyncableTask", () => {
  it("date と planStart 両方あれば対象", () => {
    expect(isSyncableTask(mkTask())).toBe(true);
  });
  it("planStart が無ければ対象外", () => {
    expect(isSyncableTask(mkTask({ planStart: undefined }))).toBe(false);
  });
  it("date が無ければ対象外", () => {
    expect(isSyncableTask(mkTask({ date: undefined }))).toBe(false);
  });
});

/** 呼び出し記録を持つモッククライアント */
function makeClient(handlers: Partial<CalendarClient> = {}): CalendarClient & {
  inserts: number;
  patches: number;
  refreshes: number;
} {
  const state = { inserts: 0, patches: 0, refreshes: 0 };
  return {
    get inserts() {
      return state.inserts;
    },
    get patches() {
      return state.patches;
    },
    get refreshes() {
      return state.refreshes;
    },
    async insertEvent(input) {
      state.inserts++;
      return handlers.insertEvent
        ? handlers.insertEvent(input)
        : ({ ok: true, id: `new-${state.inserts}` } as CalResult);
    },
    async patchEvent(eventId, input) {
      state.patches++;
      return handlers.patchEvent
        ? handlers.patchEvent(eventId, input)
        : ({ ok: true, id: eventId } as CalResult);
    },
    async refreshToken() {
      state.refreshes++;
      return handlers.refreshToken ? handlers.refreshToken() : true;
    },
  };
}

describe("syncTasksToCalendar(バッチupsert)", () => {
  it("gcalEventId 無→insert / 有→patch を選ぶ", async () => {
    const client = makeClient();
    const saved: Record<string, string> = {};
    const tasks = [
      mkTask({ id: "a", gcalEventId: undefined }),
      mkTask({ id: "b", gcalEventId: "ev-b" }),
    ];
    const s = await syncTasksToCalendar(tasks, client, (id, ev) => (saved[id] = ev));
    expect(client.inserts).toBe(1);
    expect(client.patches).toBe(1);
    expect(s.created).toBe(1);
    expect(s.updated).toBe(1);
    expect(saved.a).toBe("new-1"); // insertで採番されたidが保存される
    expect(saved.b).toBe("ev-b"); // patchはid据え置き
  });

  it("予定でないタスクはスキップして件数に計上する", async () => {
    const client = makeClient();
    const tasks = [mkTask({ id: "a" }), mkTask({ id: "b", planStart: undefined })];
    const s = await syncTasksToCalendar(tasks, client, () => {});
    expect(s.skipped).toBe(1);
    expect(s.created).toBe(1);
    expect(client.inserts).toBe(1);
  });

  it("1件失敗しても止めず、成功分だけ id を保存し失敗を集計する", async () => {
    const client = makeClient({
      insertEvent: (i) =>
        Promise.resolve(
          i.summary === "壊れ" ? { ok: false, status: 403 } : { ok: true, id: "ok" }
        ),
    });
    const saved: Record<string, string> = {};
    const tasks = [
      mkTask({ id: "a", title: "正常" }),
      mkTask({ id: "b", title: "壊れ" }),
      mkTask({ id: "c", title: "正常" }),
    ];
    const s = await syncTasksToCalendar(tasks, client, (id, ev) => (saved[id] = ev));
    expect(s.created).toBe(2);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0].title).toBe("壊れ");
    expect(saved.a).toBe("ok");
    expect(saved.c).toBe("ok");
    expect(saved.b).toBeUndefined(); // 失敗した件は未同期のまま
  });

  it("patchが404ならinsertにフォールバックして作り直し、新idを保存する", async () => {
    const client = makeClient({
      patchEvent: () => Promise.resolve({ ok: false, status: 404 }),
      insertEvent: () => Promise.resolve({ ok: true, id: "recreated" }),
    });
    const saved: Record<string, string> = {};
    const tasks = [mkTask({ id: "a", gcalEventId: "gone" })];
    const s = await syncTasksToCalendar(tasks, client, (id, ev) => (saved[id] = ev));
    expect(client.patches).toBe(1);
    expect(client.inserts).toBe(1);
    expect(s.updated).toBe(1);
    expect(saved.a).toBe("recreated");
  });

  it("401なら refreshToken 後に1回だけ再試行して成功する", async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 } as CalResult)
      .mockResolvedValueOnce({ ok: true, id: "after-refresh" } as CalResult);
    const client = makeClient({ insertEvent: insert });
    const saved: Record<string, string> = {};
    const s = await syncTasksToCalendar([mkTask({ id: "a" })], client, (id, ev) => (saved[id] = ev));
    expect(insert).toHaveBeenCalledTimes(2);
    expect(client.refreshes).toBe(1);
    expect(s.created).toBe(1);
    expect(saved.a).toBe("after-refresh");
  });

  it("401でトークン再取得に失敗したら再試行せず失敗扱い", async () => {
    const insert = vi.fn().mockResolvedValue({ ok: false, status: 401 } as CalResult);
    const client = makeClient({ insertEvent: insert, refreshToken: () => Promise.resolve(false) });
    const s = await syncTasksToCalendar([mkTask({ id: "a" })], client, () => {});
    expect(insert).toHaveBeenCalledTimes(1); // 再試行しない
    expect(s.failed).toHaveLength(1);
  });
});
