// ==============================================================
// インポート方法の選択ダイアログ(Issue #63)
//   JSON読込時に「追加読込(部分復元)」か「全リセット読込」を選ぶ。
//   ファイル選択の直後に出し、選んだモードで実際の取り込みを走らせる。
// ==============================================================
import { useEffect } from "react";

export type ImportMode = "merge" | "replace";

interface Props {
  /** 選択されたファイル名(見出しに出すだけ) */
  fileName: string;
  /** 今画面にあるタスク件数(全リセットで消える件数の目安) */
  currentCount: number;
  onSelect: (mode: ImportMode) => void;
  onCancel: () => void;
}

export default function ImportModeDialog({ fileName, currentCount, onSelect, onCancel }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-bold text-gray-800">JSONの読み込み方法</h2>
        <p className="mb-4 truncate text-xs text-gray-500" title={fileName}>
          ファイル: {fileName}
        </p>

        <div className="space-y-3">
          <button
            className="block w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-left hover:bg-blue-100"
            onClick={() => onSelect("merge")}
          >
            <p className="text-sm font-semibold text-blue-800">➕ 追加で読み込む(部分復元)</p>
            <p className="mt-1 text-xs text-gray-600">
              今のデータは残したまま取り込みます。無いものは追加、同じIDで内容が違うものは
              ファイルの内容で上書き。消したタスクを昔のバックアップから戻したいときに。
            </p>
          </button>

          <button
            className="block w-full rounded-lg border border-red-200 bg-red-50 p-3 text-left hover:bg-red-100"
            onClick={() => onSelect("replace")}
          >
            <p className="text-sm font-semibold text-red-800">♻ すべてリセットして読み込む</p>
            <p className="mt-1 text-xs text-gray-600">
              今のタスク({currentCount}件)をすべて消してから、ファイルの内容だけにします。
              別のデータに丸ごと入れ替えたいときに。(Ctrl+Zで元に戻せます)
            </p>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onCancel}
          >
            キャンセル (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
