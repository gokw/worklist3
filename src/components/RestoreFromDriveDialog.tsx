// ==============================================================
// Drive の控えから復元(変更仕様書 §4.7)
//   ローカルフォルダと違い Drive はエクスプローラで開けないので、
//   控え(ミラー + 日次14世代)を一覧して選べるようにする。
//   選んだ後は既存のインポートフローへそのまま流すので、
//   マージ規則も結果の見え方も従来と同じ。新しい書き換え経路は作らない。
// ==============================================================
import { useEffect, useState } from "react";
import type { DailyEntry } from "../lib/backupTargets/types";

export type RestoreChoice = { kind: "mirror" } | { kind: "daily"; entry: DailyEntry };

interface Props {
  /** 控えの一覧を取りに行く。失敗したらエラーを投げる */
  load: () => Promise<DailyEntry[]>;
  /** 選ばれた控えを取り込む(インポートフローへ流す) */
  onPick: (choice: RestoreChoice, label: string) => void;
  onClose: () => void;
}

export default function RestoreFromDriveDialog(p: Props) {
  const [entries, setEntries] = useState<DailyEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    p.load()
      .then((list) => {
        if (!alive) return;
        // 新しい日付が上に来るように
        setEntries([...list].sort((a, b) => (a.date < b.date ? 1 : -1)));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "控えの一覧を取得できませんでした");
      });
    return () => {
      alive = false;
    };
  }, [p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const row =
    "block w-full rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={p.onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-auto rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold text-gray-800">Drive の控えから復元</h2>
        <p className="mb-3 text-xs text-gray-500">
          選ぶと、いつものインポート(追加読込 / 全リセット読込)に進みます。
          この場でデータが書き換わることはありません。
        </p>

        {error && <p className="mb-2 text-sm text-amber-700">⚠ {error}</p>}
        {!entries && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

        {entries && (
          <div className="space-y-0.5">
            <button
              className={`${row} font-semibold`}
              onClick={() => p.onPick({ kind: "mirror" }, "最新の控え(ミラー)")}
            >
              ⭐ 最新の控え(ミラー)
              <span className="ml-1 text-xs font-normal text-gray-500">
                いま Drive にある最新の状態
              </span>
            </button>

            {entries.length > 0 && (
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-gray-400">
                日次の控え({entries.length}世代)
              </div>
            )}
            {entries.map((e) => (
              <button
                key={e.key}
                className={row}
                onClick={() => p.onPick({ kind: "daily", entry: e }, e.date)}
                title={e.name}
              >
                📄 {e.date}
              </button>
            ))}
            {entries.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-500">
                日次の控えはまだありません(接続した翌日から貯まります)
              </p>
            )}
          </div>
        )}

        <div className="mt-3 text-right">
          <button
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
            onClick={p.onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
