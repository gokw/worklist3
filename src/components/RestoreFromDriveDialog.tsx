// ==============================================================
// Drive の控えの一覧(変更仕様書 §4.7、変更仕様書_引き継ぎを3つに分ける.md §4.2/§4.4)
//   ローカルフォルダと違い Drive はエクスプローラで開けないので、
//   控えを一覧して選べるようにする。用途は2つ。
//     import … 取り込む(既存のインポートフローへ流す。手元が変わる)
//     view   … 見るだけ(#109 §4.2。手元には触れない)
//
//   退避・救出ファイル(#109 §4.4)もここに出す。出さないと、書けているのに
//   読み戻せない。ただし日次と混ぜない。「最新の控え」と取り違えて全リセットで
//   読み込まれると、直すつもりで新しい喪失を作るため、節を分けて注意を添える。
// ==============================================================
import { useEffect, useState } from "react";
import type { DailyEntry, SideEntry } from "../lib/backupTargets/types";
import { formatStamp } from "../lib/baton";

export type RestoreChoice =
  | { kind: "mirror" }
  | { kind: "daily"; entry: DailyEntry }
  | { kind: "side"; entry: SideEntry };

interface Props {
  /** 取り込むのか、見るだけなのか */
  purpose: "import" | "view";
  /** 控えの一覧を取りに行く。失敗したらエラーを投げる */
  load: () => Promise<DailyEntry[]>;
  /** 退避・救出の一覧。取れなければ空でよい(一覧の主目的を妨げない) */
  loadSideFiles: () => Promise<SideEntry[]>;
  /** 選ばれた控え。isSideFile なら取り込みの既定を追加読込にする */
  onPick: (choice: RestoreChoice, label: string, isSideFile: boolean) => void;
  onClose: () => void;
}

export default function RestoreFromDriveDialog(p: Props) {
  const [entries, setEntries] = useState<DailyEntry[] | null>(null);
  const [sides, setSides] = useState<SideEntry[]>([]);
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
    // 退避・救出は補助情報。取れなくても日次の一覧は使えるようにする
    p.loadSideFiles()
      .then((list) => {
        if (alive) setSides([...list].sort((a, b) => (a.stamp < b.stamp ? 1 : -1)));
      })
      .catch((e) => console.error("退避・救出の一覧を取得できませんでした", e));
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
        <h2 className="mb-1 text-base font-semibold text-gray-800">
          {p.purpose === "view" ? "Drive の内容を見る" : "Drive の控えから復元"}
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          {p.purpose === "view"
            ? "選ぶと画面に表示します。この端末に保存されているデータは変わりません。"
            : "選ぶと、いつものインポート(追加読込 / 全リセット読込)に進みます。この場でデータが書き換わることはありません。"}
        </p>

        {error && <p className="mb-2 text-sm text-amber-700">⚠ {error}</p>}
        {!entries && !error && <p className="text-sm text-gray-500">読み込み中…</p>}

        {entries && (
          <div className="space-y-0.5">
            <button
              className={`${row} font-semibold`}
              onClick={() => p.onPick({ kind: "mirror" }, "最新の控え(ミラー)", false)}
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
                onClick={() => p.onPick({ kind: "daily", entry: e }, e.date, false)}
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

            {/* 退避・救出(#109 §4.4)。日次と混ぜない */}
            {sides.length > 0 && (
              <>
                <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-gray-400">
                  退避・救出({sides.length}件) — 自動では消えません
                </div>
                <p className="px-3 pb-1 text-[11px] text-amber-700">
                  本流から外れた控えです。取り込むときは「追加で読み込む」を選んでください。
                </p>
                {sides.map((e) => (
                  <button
                    key={e.key}
                    className={row}
                    onClick={() => p.onPick({ kind: "side", entry: e }, e.name, true)}
                    title={e.name}
                  >
                    {e.kind === "救出" ? "🛟" : "📦"} {e.kind}　{formatStamp(e.stamp)}
                  </button>
                ))}
              </>
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
