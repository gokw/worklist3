// ==============================================================
// 中断(割り込み)ダイアログ(Excel版 InterruputTask 踏襲)
//   元タスクを「消化分」と「残り」に分割し、任意で割込みタスクを即開始
// ==============================================================
import { useEffect, useState } from "react";
import type { Task } from "../types";
import { hhmmToMin, nowHHMM } from "../lib/date";

/** 今この瞬間に終了した場合の消化時間(分) */
function consumedMinIfEndedNow(task: Task): number {
  const s = hhmmToMin(task.actStart);
  const e = hhmmToMin(nowHHMM());
  if (s === undefined || e === undefined) return 0;
  return e >= s ? e - s : e - s + 1440;
}

interface Props {
  task: Task;
  onConfirm: (interruptTitle: string | undefined, interruptEstimateMin: number) => void;
  onClose: () => void;
}

export default function InterruptDialog({ task, onConfirm, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const consumed = consumedMinIfEndedNow(task);
  const remaining = Math.max(task.estimateMin - consumed, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-2 text-lg font-bold text-gray-800">タスクを中断</h2>
        <p className="mb-3 text-sm text-gray-600">
          「{task.title}」をここまでの消化分(約{consumed}分)で確定し、
          残り<span className="font-semibold">約{remaining}分</span>
          を「中断中」タスクとして引き継ぎます。
        </p>

        <label className="mb-1 block text-xs font-semibold text-gray-500">
          割込みタスク名(任意・入力するとすぐに開始されます)
        </label>
        <input
          autoFocus
          className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(title || undefined, estimate);
          }}
          placeholder="例: 至急の電話対応"
        />
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          割込みタスクの見積(分)
        </label>
        <input
          type="number"
          min={0}
          className="mb-4 w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          value={estimate}
          onChange={(e) => setEstimate(Math.max(0, Number(e.target.value)))}
        />

        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded border border-orange-300 bg-orange-50 px-4 py-1.5 text-sm text-orange-700 hover:bg-orange-100"
            onClick={() => onConfirm(undefined, 0)}
          >
            中断のみ
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={title.trim() === ""}
            onClick={() => onConfirm(title, estimate)}
          >
            割込みを開始
          </button>
        </div>
      </div>
    </div>
  );
}
