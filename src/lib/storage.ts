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
      return parsed as Task[];
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
