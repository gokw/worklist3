// ==============================================================
// ショートカットキー一覧(?キーで開く)
//   「パッと見て、パッと消せる」ことが役目。読むだけの画面なので、
//   Esc / ? / どこをクリックしても閉じる。操作を覚える必要がない。
// ==============================================================
import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

/** [キー, 説明] の並び */
const TASK_KEYS: [string, string][] = [
  ["↑ / ↓", "行(タスク)を移動"],
  ["j / k", "行を移動(vim準拠。j=下 / k=上)"],
  ["← / →", "列(項目)を移動"],
  ["PageUp / PageDown", "5行ずつ移動"],
  ["Ctrl + ↑ / ↓", "前/次のカテゴリの先頭へ"],
  ["Home", "今の作業位置へ(一覧は先頭から表示)"],
  ["Shift + ↑ / ↓", "範囲選択"],
  ["Space", "選択(一括編集・連続時刻の対象)"],
  ["Enter", "セルを編集(列未選択なら詳細編集)。ダブルクリックでも編集"],
  ["Ctrl + Enter", "詳細編集を開く"],
  ["S / E", "開始 / 終了"],
  ["I", "中断(割り込み)"],
  ["W", "待ち ON/OFF"],
  ["C", "コピー(複製)"],
  ["P", "定期タスクを次の日程へ延期"],
  ["H / L", "日付を前日 / 翌日へ(複数選択中は一括)"],
  ["Delete", "削除(複数選択中は一括)"],
];

const GLOBAL_KEYS: [string, string][] = [
  ["N / Ctrl + K", "タスク追加"],
  ["V", "クリップボードから取込"],
  ["M", "仕事 → 個人 → すべて を巡回"],
  ["?", "このヘルプ"],
  ["Esc", "ダイアログ・セル編集を閉じる(複数選択中は選択を解除)"],
];

function KeyRow({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <kbd className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
        {k}
      </kbd>
      <span className="text-xs text-gray-600">{desc}</span>
    </div>
  );
}

export default function ShortcutHelpDialog({ onClose }: Props) {
  useEffect(() => {
    // 読むだけの画面なので、Esc でも ? でも閉じられるようにする
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  return (
    // どこをクリックしても閉じる(読むだけなので中身を触る用事がない)
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-gray-800">ショートカットキー</h2>
          <span className="text-xs text-gray-400">Esc / ? / クリック で閉じる</span>
        </div>

        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-gray-400">
              タスクへの操作(↑↓でカーソルを合わせてから)
            </p>
            {TASK_KEYS.map(([k, d]) => (
              <KeyRow key={k} k={k} desc={d} />
            ))}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-gray-400">全体の操作</p>
            {GLOBAL_KEYS.map(([k, d]) => (
              <KeyRow key={k} k={k} desc={d} />
            ))}
            <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
              日付の前日/翌日の移動は「今日」ビューの ◀▶ から。
              <br />
              時刻の入力はすべて数字4桁(例 0930)。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
