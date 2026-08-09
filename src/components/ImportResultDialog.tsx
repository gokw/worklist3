// ==============================================================
// インポート結果ダイアログ(Issue #12)
//   読込/追加/上書き/変更なし/不正データの件数と、上書きした内容を明示する。
// ==============================================================
import { useEffect } from "react";

export interface ImportResult {
  /** 読み込み方法。merge=追加(部分復元) / replace=全リセット読込 */
  mode: "merge" | "replace";
  /** ファイル内の総件数 */
  total: number;
  /** 新しく追加した件数(merge時)/ 取り込んだ件数(replace時) */
  added: number;
  /** 中身が違うのでファイルの内容で上書きしたタスク名(merge時のみ) */
  updatedTitles: string[];
  /** 完全に同じで何もしなかった件数(merge時のみ) */
  same: number;
  /** 形式不正でスキップした件数 */
  invalid: number;
  /** 全リセットで消した既存タスク件数(replace時のみ) */
  removed?: number;
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

  const changed = result.added + result.updatedTitles.length;
  const isReplace = result.mode === "replace";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-bold text-gray-800">
          {isReplace ? "インポート結果(全リセット読込)" : "インポート結果(追加読込)"}
        </h2>

        {isReplace ? (
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-gray-200 bg-gray-50 p-2">
              <p className="text-xl font-bold text-gray-700">{result.total}</p>
              <p className="text-[11px] text-gray-500">読み込み</p>
            </div>
            <div className="rounded border border-green-200 bg-green-50 p-2">
              <p className="text-xl font-bold text-green-700">{result.added}</p>
              <p className="text-[11px] text-green-700">取り込み</p>
            </div>
            <div
              className={`rounded border p-2 ${
                (result.removed ?? 0) > 0
                  ? "border-red-200 bg-red-50"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              <p
                className={`text-xl font-bold ${
                  (result.removed ?? 0) > 0 ? "text-red-700" : "text-gray-400"
                }`}
              >
                {result.removed ?? 0}
              </p>
              <p
                className={`text-[11px] ${
                  (result.removed ?? 0) > 0 ? "text-red-700" : "text-gray-500"
                }`}
              >
                消した既存
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-3 grid grid-cols-4 gap-2 text-center">
            <div className="rounded border border-gray-200 bg-gray-50 p-2">
              <p className="text-xl font-bold text-gray-700">{result.total}</p>
              <p className="text-[11px] text-gray-500">読み込み</p>
            </div>
            <div className="rounded border border-green-200 bg-green-50 p-2">
              <p className="text-xl font-bold text-green-700">{result.added}</p>
              <p className="text-[11px] text-green-700">追加</p>
            </div>
            <div
              className={`rounded border p-2 ${
                result.updatedTitles.length > 0
                  ? "border-blue-200 bg-blue-50"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              <p
                className={`text-xl font-bold ${
                  result.updatedTitles.length > 0 ? "text-blue-700" : "text-gray-400"
                }`}
              >
                {result.updatedTitles.length}
              </p>
              <p
                className={`text-[11px] ${
                  result.updatedTitles.length > 0 ? "text-blue-700" : "text-gray-500"
                }`}
              >
                上書き
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-2">
              <p className="text-xl font-bold text-gray-400">{result.same}</p>
              <p className="text-[11px] text-gray-500">変更なし</p>
            </div>
          </div>
        )}

        {isReplace && (
          <p className="mb-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
            今までのデータを消して、ファイルの内容だけにしました(Ctrl+Zで元に戻せます)
          </p>
        )}

        {!isReplace && changed === 0 && result.invalid === 0 && (
          <p className="mb-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
            ファイルの内容は現在のデータと完全に同じでした(変更なし)
          </p>
        )}

        {result.updatedTitles.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-xs font-semibold text-blue-700">
              ファイルの内容で上書きしたタスク({result.updatedTitles.length}件)
            </p>
            <ul className="max-h-40 overflow-auto rounded border border-blue-200 bg-blue-50 p-2 text-xs text-gray-700">
              {result.updatedTitles.map((title, i) => (
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
