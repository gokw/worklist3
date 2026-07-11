// ==============================================================
// データ保存層
// 今は localStorage 保存。将来サーバー同期にする場合は
// TaskRepository の実装を差し替えるだけで済む構造にしてある。
// ==============================================================
import type { Task } from "../types";

export interface TaskRepository {
  load(): Task[];
  save(tasks: Task[]): void;
}

const STORAGE_KEY = "worklist3.tasks.v1";

export class LocalStorageRepository implements TaskRepository {
  load(): Task[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(migrate);
    } catch (e) {
      console.error("タスクの読み込みに失敗しました", e);
      return [];
    }
  }

  save(tasks: Task[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error("タスクの保存に失敗しました", e);
    }
  }
}

/**
 * 旧形式データの変換。
 * 初期バージョンは status(5値)を持っていたが、現在は「待ち」フラグのみを保存し、
 * 未着手/進行中/完了は実績から自動判定する方式に変更した。
 */
function migrate(raw: Record<string, unknown>): Task {
  const t = { ...raw } as unknown as Task & { status?: string };
  if (t.waiting === undefined) {
    t.waiting = t.status === "waiting";
    // 旧データで「完了」だが終了実績が無いものは、完了状態を保つため実績を補完
    if (t.status === "done" && !t.actEnd) t.actEnd = t.actStart ?? "00:00";
    delete t.status;
  }
  return t;
}

export const repository: TaskRepository = new LocalStorageRepository();

/** バックアップ用: 全タスクをJSONファイルとしてダウンロード */
export function exportTasksAsJson(tasks: Task[]): void {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worklist3-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
