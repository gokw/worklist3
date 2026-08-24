// ==============================================================
// 見積(見込み時間)入力ミニダイアログ。Issue #74
//   見積が0のタスクを開始するとき、開始時刻の確定後にこのダイアログを出して
//   見積(分)を入力させる。時間を意識して着手できるようにするのが目的。
//   - 手入力: 分の数値
//   - クイックボタン(15/30/45/60/90分)は1タップで確定して開始まで進む
//   - 「0のまま開始」で見積なしのまま開始できる(必須にはしない)
//   - キャンセル(Esc/×)は開始自体を中止する
// ==============================================================
import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";

interface Props {
  task: Task;
  /** 見積(分)を確定して開始する。0のまま開始する場合は 0 が渡る */
  onConfirm: (estimateMin: number) => void;
  onClose: () => void;
}

const QUICK_MINUTES = [15, 30, 45, 60, 90];

const quickBtn =
  "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100";

export default function EstimateInputDialog({ task, onConfirm, onClose }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => onConfirm(Math.max(0, Number(value) || 0));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xs rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-base font-bold text-gray-800">見積時間を入力</h2>
        <p className="mb-2 text-xs text-gray-500">
          「{task.title}」の見積(分)を入力してください
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="number"
            min={0}
            className="w-full rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-blue-500 focus:outline-none"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="30"
            inputMode="numeric"
          />
          <span className="shrink-0 text-sm text-gray-500">分</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          数字＋Enter。下のボタンは1タップで開始します
        </p>

        {/* クイックボタン=押した瞬間に確定して開始(TimeInputDialogと同じ挙動) */}
        <div className="mt-3 flex flex-wrap gap-1">
          {QUICK_MINUTES.map((m) => (
            <button key={m} type="button" className={quickBtn} onClick={() => onConfirm(m)}>
              {m}分
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => onConfirm(0)}
          >
            0のまま開始
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={submit}
          >
            開始
          </button>
        </div>
      </div>
    </div>
  );
}
