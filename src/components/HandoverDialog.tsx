// ==============================================================
// 「読み込まずに引き継ぐ」系の確認ダイアログ(変更仕様書_引き継ぎを3つに分ける.md §4.3)
//
//   この形の操作は、Drive 側を手元の内容で上書きする。だから必ず
//   **退避 → 引き継ぎ** の順に通す。退避は「相手のバックアップ済みの編集を
//   消す事故」に対する唯一の網で、日次コピーは同じ日なら同名で上書きされるため
//   当日の事故を救えない。
//
//   ただし退避に失敗しても**操作は止めない**。止めると圏外や権限切れのときに
//   永久に引き継げなくなり、#84 の閉じ込めを繰り返す。事実を見せて人に決めさせる。
//
//   バナーからの経路と閲覧中からの経路で同じ判断が要るので、ここに1つだけ置く。
// ==============================================================
import { useEffect, useState } from "react";

export interface HandoverRow {
  label: string;
  value: string;
  strong?: boolean;
}

interface Props {
  title: string;
  /** 何が起きるかの一文 */
  description: React.ReactNode;
  rows: HandoverRow[];
  /** 上書きで失われうるものの説明(必ず出す) */
  danger: React.ReactNode;
  /** 件数差など、追加で強調する警告。空なら出さない */
  warning?: string;
  /** 上書き前のミラーを退避する。ファイル名を返す(退避不要なら空文字) */
  onSnapshot: () => Promise<string>;
  /** 退避のあと実際に引き継ぐ */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  confirmLabel: string;
}

export default function HandoverDialog(p: Props) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [failed, setFailed] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [p]);

  /** 退避してから引き継ぐ。退避に失敗したら、もう一段の確認へ落とす */
  const go = async () => {
    setBusy(true);
    setFailed("");
    try {
      setSaved(await p.onSnapshot());
    } catch (e) {
      // 退避できないこと自体は止める理由にならない。人に決めさせる
      setFailed(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    await finish();
  };

  const finish = async () => {
    setBusy(true);
    try {
      await p.onConfirm();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={p.onClose}
    >
      <div
        className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-bold text-gray-800">{p.title}</h2>
        <p className="mb-3 text-sm text-gray-700">{p.description}</p>

        <dl className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          {p.rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <dt className="shrink-0 text-gray-500">{r.label}</dt>
              <dd className={`text-right ${r.strong ? "font-semibold" : ""}`}>{r.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          ⚠ {p.danger}
          {p.warning && <span className="mt-1 block font-semibold">{p.warning}</span>}
        </p>

        {!failed && (
          <p className="mb-4 text-xs text-gray-500">
            上書きされる前の Drive の内容は、退避ファイルとして残します。
            この操作は元に戻せません（Ctrl+Z では戻りません）。
          </p>
        )}

        {failed && (
          <div className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">⚠ Drive の現在の内容を退避できませんでした。</p>
            <p className="mt-1 break-all text-xs">{failed}</p>
            <p className="mt-2 text-xs">
              このまま引き継ぐと、Drive 側の内容はこの端末の内容で上書きされ、
              <b>元に戻す手段がありません。</b>
            </p>
          </div>
        )}

        {saved && !failed && (
          <p className="mb-3 break-all text-xs text-gray-500">退避先: {saved}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            onClick={p.onClose}
          >
            やめる
          </button>
          <button
            type="button"
            disabled={busy}
            className={`rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
              failed ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
            onClick={() => void (failed ? finish() : go())}
          >
            {busy ? "処理中…" : failed ? "それでも引き継ぐ" : p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
