// ==============================================================
// タスク分割ダイアログ: 1タスクを複数の子タスクに分ける
// ==============================================================
import { useEffect, useState } from "react";
import type { Task } from "../types";

interface Props {
  task: Task;
  onConfirm: (children: { title: string; estimateMin: number }[]) => void;
  onClose: () => void;
}

export default function SplitDialog({ task, onConfirm, onClose }: Props) {
  const [text, setText] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 1行 = 「子タスク名, 見積分」(見積は省略可)
  const parse = (): { title: string; estimateMin: number }[] =>
    text
      .split(/\r\n|\r|\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map((l) => {
        const m = l.match(/^(.*?)[,、]\s*(\d+)\s*$/);
        if (m) return { title: m[1].trim(), estimateMin: Number(m[2]) };
        return { title: l, estimateMin: 0 };
      });

  const children = parse();
  const total = children.reduce((s, c) => s + c.estimateMin, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-2 text-lg font-bold text-gray-800">タスクを分割</h2>
        <p className="mb-3 text-sm text-gray-600">
          「{task.title}」(見積{task.estimateMin}分)を子タスクに分割します。
          <br />
          1行に1タスク、「タスク名, 見積分」の形式で入力してください(見積は省略可)。
        </p>
        <textarea
          autoFocus
          className="mb-2 h-32 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"資料の下書き, 30\nレビュー依頼, 10\n修正して提出, 20"}
        />
        <p className="mb-4 text-xs text-gray-500">
          {children.length}件 / 合計 {total} 分
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={children.length === 0}
            onClick={() => onConfirm(children)}
          >
            分割する
          </button>
        </div>
      </div>
    </div>
  );
}
