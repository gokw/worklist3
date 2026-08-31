// ==============================================================
// 手番なしのバナーと、奪取の確認ダイアログ(変更仕様書_複数台利用.md §4.4/§4.5)
//
//   奪取は「ロックを奪う」ではなく「読み込んでから引き継ぐ」1操作。
//   相手の状態がどうであれ、**奪取自体は決してブロックしない**。
//   ここで止めると、相手のブラウザデータが消えたときに永久に手番を
//   取れなくなる(#84 の閉じ込めと同じ形)。警告は出すが禁止はしない。
// ==============================================================
import { useEffect, useState } from "react";
import type { TakeoverPlan } from "../lib/backup";
import { absoluteTime, ownerLabel, relativeTime } from "../lib/baton";

interface Props {
  ownerName: string;
  /** 相手のミラーの最終更新(ISO)。空なら不明 */
  ownerBackupAt: string;
  ownerCount: number | null;
  /** 手元の件数と最終更新(表示のみ) */
  currentCount: number;
  checking: boolean;
  /** 下調べ(ミラー取得＋サニティガード)。失敗したら理由を投げる */
  onPlan: () => Promise<TakeoverPlan>;
  /** 実際に読み込んで手番を取る */
  onTakeover: (plan: TakeoverPlan) => Promise<void>;
}

export default function BatonBanner(p: Props) {
  const [plan, setPlan] = useState<TakeoverPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const label = ownerLabel(p.ownerName);
  const at = p.ownerBackupAt;

  const open = async () => {
    setBusy(true);
    setError("");
    try {
      setPlan(await p.onPlan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">この端末は読み取り専用です</span>
          <span>
            更新中の端末: <b>{label}</b>
          </span>
          {at && (
            <span>
              最終バックアップ: {absoluteTime(at)}（{relativeTime(at, Date.now())}）
              {p.ownerCount !== null && ` / ${p.ownerCount}件`}
            </span>
          )}
          <span className="text-amber-700">いまの手元: {p.currentCount}件</span>
          {p.checking && <span className="text-amber-600">確認中…</span>}
          <button
            type="button"
            disabled={busy}
            onClick={open}
            className="ml-auto rounded border border-amber-600 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? "読み込み中…" : "読み込んで、この端末で更新する"}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      {plan && (
        <TakeoverDialog
          plan={plan}
          ownerName={label}
          onClose={() => setPlan(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await p.onTakeover(plan);
              setPlan(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

function TakeoverDialog({
  plan,
  ownerName,
  onConfirm,
  onClose,
}: {
  plan: TakeoverPlan;
  ownerName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
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
        <h2 className="mb-3 text-base font-bold text-gray-800">この端末で更新する</h2>

        <p className="mb-3 text-sm text-gray-700">
          {ownerName} のデータを読み込んでから、この端末を更新側にします。
        </p>

        <dl className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">読み込む件数</dt>
            <dd className="font-semibold">{plan.count}件</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">いまの手元</dt>
            <dd>{plan.currentCount}件（置き換わります）</dd>
          </div>
        </dl>

        {/* サニティガード。禁止ではなく警告(明示確認で続行できる) */}
        {plan.guard && (
          <p className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            ⚠ {plan.guard}
          </p>
        )}
        {plan.stale && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            ⚠ {plan.stale}
          </p>
        )}

        <p className="mb-4 text-xs text-gray-500">
          この操作は元に戻せません（Ctrl+Z では戻りません）。
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            onClick={onClose}
          >
            やめる
          </button>
          <button
            type="button"
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
            onClick={onConfirm}
          >
            読み込んで更新側になる
          </button>
        </div>
      </div>
    </div>
  );
}
