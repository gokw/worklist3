// ==============================================================
// インポート結果ダイアログ(Issue #12)
//   読込/登録/重複スキップ/不正データの件数と、スキップした内容を明示する。
// ==============================================================
import { useEffect } from "react";

export interface ImportResult {
  /** ファイル内の総件数 */
  total: number;
  /** 新規登録した件数 */
  added: number;
  /** 重複でスキップしたタスク名 */
  duplicates: string[];
  /** 形式不正でスキップした件数 */
  invalid: number;
}

interface Props {
  result: ImportResult;
  onClose: () => void;
}

export default function ImportResultDialog({ result, onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const hasWarn = result.duplicates.length > 0 || result.invalid > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-800">インポート結果</h2>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-gray-200 bg-gray-50 p-2">
            <p className="text-xl font-bold text-gray-700">{result.total}</p>
            <p className="text-[11px] text-gray-500">読み込み</p>
          </div>
          <div className="rounded border border-green-200 bg-green-50 p-2">
            <p className="text-xl font-bold text-green-700">{result.added}</p>
            <p className="text-[11px] text-green-700">登録</p>
          </div>
          <div
            className={`rounded border p-2 ${
              hasWarn ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-gray-50"
            }`}
          >
            <p className={`text-xl font-bold ${hasWarn ? "text-yellow-700" : "text-gray-400"}`}>
              {result.duplicates.length + result.invalid}
            </p>
            <p className={`text-[11px] ${hasWarn ? "text-yellow-700" : "text-gray-500"}`}>
              スキップ
            </p>
          </div>
        </div>

        {result.duplicates.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-xs font-semibold text-yellow-700">
              ⚠ 重複のため登録しなかったタスク({result.duplicates.length}件)
            </p>
            <ul className="max-h-40 overflow-auto rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-gray-700">
              {result.duplicates.map((title, i) => (
                <li key={i} className="truncate" title={title}>
                  ・{title || "(無題)"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.invalid > 0 && (
          <p className="mb-2 text-xs text-red-600">
            ⚠ 形式が不正なデータを {result.invalid} 件スキップしました(id・タスク名の無い項目)
          </p>
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
