// ==============================================================
// カレンダー登録の結果ダイアログ(ImportResultDialog と同じ作り)
//   新規/更新/スキップ(時刻なし)/失敗 を件数で示し、失敗は理由も出す。
// ==============================================================
import { useEffect } from "react";
import type { SyncSummary } from "../lib/gcalMap";

interface Props {
  result: SyncSummary;
  onClose: () => void;
}

export default function CalendarSyncResultDialog({ result, onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const cell = (n: number, label: string, tone: "gray" | "green" | "blue" | "red") => {
    const on = n > 0;
    const color = {
      gray: "border-gray-200 bg-gray-50 text-gray-700",
      green: on ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-400",
      blue: on ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-400",
      red: on ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-400",
    }[tone];
    return (
      <div className={`rounded border p-2 ${color}`}>
        <p className="text-xl font-bold">{n}</p>
        <p className="text-[11px]">{label}</p>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-800">カレンダー登録の結果</h2>

        <div className="mb-3 grid grid-cols-4 gap-2 text-center">
          {cell(result.created, "新規", "green")}
          {cell(result.updated, "更新", "blue")}
          {cell(result.skipped, "時刻なし", "gray")}
          {cell(result.failed.length, "失敗", "red")}
        </div>

        {result.skipped > 0 && (
          <p className="mb-2 text-xs text-gray-500">
            開始時刻のないタスクは予定ではないため、{result.skipped}件スキップしました
          </p>
        )}

        {result.failed.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-xs font-semibold text-red-700">
              ⚠ 登録できなかったタスク({result.failed.length}件・もう一度押すと再試行します)
            </p>
            <ul className="max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-gray-700">
              {result.failed.map((f, i) => (
                <li key={i} className="truncate" title={`${f.title}: ${f.reason}`}>
                  ・{f.title || "(無題)"} — {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={onClose}
          >
            OK (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
