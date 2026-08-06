// ==============================================================
// メモ表示ダイアログ(#60)
//   タスク一覧の 📝 をクリックすると開く。メモ本文を改行そのままで表示し、
//   ワンクリックでクリップボードへコピーできる。読むだけの軽い画面なので
//   Esc / 背景クリック / 閉じるボタンで閉じる。
// ==============================================================
import { useEffect } from "react";

interface Props {
  title: string;
  /** 表示・コピーするメモ本文(改行を含む) */
  memo: string;
  /** コピー実行(クリップボード書き込み＋トーストは呼び出し側) */
  onCopy: (text: string) => void;
  onClose: () => void;
}

export default function MemoDialog({ title, memo, onCopy, onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="truncate text-base font-bold text-gray-800" title={title}>
            📝 {title || "(無題)"}
          </h2>
          <span className="shrink-0 text-xs text-gray-400">Esc / 背景クリックで閉じる</span>
        </div>

        {/* 改行・空白をそのまま見せる(#60「改行などもきちんと」)。長文は縦スクロール */}
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-gray-50 p-3 font-sans text-sm text-gray-700">
          {memo}
        </pre>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600"
            onClick={() => onCopy(memo)}
          >
            📋 コピー
          </button>
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
