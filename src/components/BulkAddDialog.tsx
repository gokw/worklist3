// ==============================================================
// 複数タスク一括登録ダイアログ(Issue #9)
//   テキストを貼り付け → プレビューで確認 → まとめて登録。
// ==============================================================
import { useEffect, useMemo, useState } from "react";
import { parseBulkText, type ParsedRow } from "../lib/bulkParse";
import { formatDateJa } from "../lib/date";
import { REPEAT_UNIT_LABELS, type RepeatConfig } from "../types";

interface Props {
  /** 日付を省略した行に使う既定日 */
  defaultDate: string;
  onRegister: (rows: ParsedRow[]) => void;
  onClose: () => void;
}

const PLACEHOLDER = `例(1行1件。タブ区切りやExcelからの貼り付けもOK):
2026-07-15\t請求書を送る\t経理\t30
7/16\t定例会議の準備
牛乳を買う

もともとの worklist(day/st/rpt/contents…)をヘッダごと貼り付けてもOK`;

/** 繰り返し設定を短いラベルにする(プレビュー用) */
function repeatLabel(r: RepeatConfig): string {
  const base = `毎${r.interval}${REPEAT_UNIT_LABELS[r.unit]}`;
  return r.copyPlanStart ? `${base}⟳時刻` : base;
}

export default function BulkAddDialog({ defaultDate, onRegister, onClose }: Props) {
  const [text, setText] = useState("");
  const rows = useMemo(() => parseBulkText(text, defaultDate), [text, defaultDate]);
  // 旧worklist形式(Issue #22)で取り込めた列があるときだけ、プレビューに追加列を出す
  const hasDetail = useMemo(
    () => rows.some((r) => r.planStart || r.repeat || r.waiting),
    [rows]
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-8 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-bold text-gray-800">複数タスクを一括登録</h2>
        <p className="mb-3 text-xs text-gray-500">
          1行1件で貼り付けてください。タブ区切りなら{" "}
          <span className="font-semibold">日付 → タイトル → カテゴリ → 見積(分)</span> の順。
          もともとの worklist(day/st/rpt/contents…)をそのまま貼り付けても取り込めます。
          日付を省略した行(や「日」だけの行)は{" "}
          <span className="font-semibold">{formatDateJa(defaultDate)}</span> の年月に合わせます。
        </p>

        <textarea
          autoFocus
          className="h-40 w-full rounded border border-gray-300 p-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
        />

        {/* プレビュー */}
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-gray-600">
            プレビュー({rows.length}件)
          </p>
          <div className="max-h-52 overflow-auto rounded border border-gray-200">
            {rows.length === 0 ? (
              <p className="p-3 text-center text-xs text-gray-400">
                ここに解析結果が表示されます。
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100">
                  <tr>
                    <th className="px-2 py-1 text-left text-xs font-semibold text-gray-600">日付</th>
                    <th className="px-2 py-1 text-left text-xs font-semibold text-gray-600">タスク名</th>
                    <th className="px-2 py-1 text-left text-xs font-semibold text-gray-600">カテゴリ</th>
                    <th className="px-2 py-1 text-right text-xs font-semibold text-gray-600">見積</th>
                    {hasDetail && (
                      <>
                        <th className="px-2 py-1 text-left text-xs font-semibold text-gray-600">予定</th>
                        <th className="px-2 py-1 text-left text-xs font-semibold text-gray-600">繰り返し</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-2 py-1 text-gray-700">
                        {formatDateJa(r.date)}
                      </td>
                      <td className="px-2 py-1 text-gray-800">
                        {r.waiting && <span className="mr-1 text-amber-600" title="待ち">待</span>}
                        {r.title}
                      </td>
                      <td className="px-2 py-1 text-gray-500">{r.category}</td>
                      <td className="px-2 py-1 text-right text-gray-500">
                        {r.estimateMin || ""}
                      </td>
                      {hasDetail && (
                        <>
                          <td className="whitespace-nowrap px-2 py-1 text-gray-500">
                            {r.planStart ?? ""}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-gray-500">
                            {r.repeat ? repeatLabel(r.repeat) : ""}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={rows.length === 0}
            onClick={() => onRegister(rows)}
          >
            {rows.length}件を登録
          </button>
        </div>
      </div>
    </div>
  );
}
