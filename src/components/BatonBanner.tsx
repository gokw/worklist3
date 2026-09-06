// ==============================================================
// 手番なしのバナーと、引き継ぎの確認ダイアログ
//   変更仕様書_複数台利用.md §4.4/§4.5、変更仕様書_引き継ぎを3つに分ける.md(#109)
//
//   引き継ぎは「画面のデータをどうするか × 手番をどうするか」の2軸に分かれる。
//   束ねると、手元が最新の端末で押したときに未送信の編集が消える(#109)。
//     見るだけ           … 画面は Drive、手元は触らない、手番も取らない
//     読み込んで引き継ぐ … 従来どおり(主ボタン。いちばん安全でいちばん多い)
//     手元のまま引き継ぐ … 手元を保って手番だけ取る。Drive 側を上書きするので確認を厚く
//
//   奪取は「ロックを奪う」ではなく「読み込んでから引き継ぐ」1操作。
//   相手の状態がどうであれ、**奪取自体は決してブロックしない**。
//   ここで止めると、相手のブラウザデータが消えたときに永久に手番を
//   取れなくなる(#84 の閉じ込めと同じ形)。警告は出すが禁止はしない。
// ==============================================================
import { useEffect, useState } from "react";
import type { TakeoverPlan } from "../lib/backup";
import { absoluteTime, keepWarning, ownerLabel, relativeTime } from "../lib/baton";
import HandoverDialog from "./HandoverDialog";

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
  /** 見るだけ(#109 §4.2)。手元には触れない */
  onView: () => Promise<void>;
  /** 上書きされる前のミラーを退避する。ファイル名を返す(退避不要なら空文字) */
  onSnapshot: () => Promise<string>;
  /** 手元のまま手番を取る(#109 §4.3) */
  onTakeoverKeep: () => Promise<void>;
}

export default function BatonBanner(p: Props) {
  const [plan, setPlan] = useState<TakeoverPlan | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** どのボタンも、失敗したら理由をバナーに出す(黙って何も起きないのが最悪) */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
          {/* 危険な順に奥へ。主ボタン(いちばん安全)を左に置く */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={open}
              className="rounded border border-amber-600 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {busy ? "処理中…" : "読み込んで、この端末で更新する"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(p.onView)}
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title="Drive の内容を表示します。この端末のデータは変わりません"
            >
              見るだけ
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setKeepOpen(true)}
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title="この端末のデータのまま、更新側になります(Drive 側は上書きされます)"
            >
              手元のまま更新する
            </button>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      {keepOpen && (
        <HandoverDialog
          title="この端末のデータで、更新を引き継ぐ"
          description={
            <>
              読み込みません。<b>この端末のデータをそのまま使って</b>更新側になります。
            </>
          }
          rows={[
            { label: "この端末", value: `${p.currentCount}件`, strong: true },
            {
              label: "Drive の最新",
              value:
                (p.ownerCount === null ? "不明" : `${p.ownerCount}件`) +
                (at ? `（${absoluteTime(at)} ／ ${label}）` : ""),
            },
          ]}
          danger={`Drive 側の内容は、この端末の内容で上書きされます。${label} でしか行っていない変更があれば、それは失われます。`}
          warning={keepWarning(p.ownerCount, p.currentCount)}
          confirmLabel="この端末のデータで引き継ぐ"
          onSnapshot={p.onSnapshot}
          onClose={() => setKeepOpen(false)}
          onConfirm={async () => {
            await p.onTakeoverKeep();
            setKeepOpen(false);
          }}
        />
      )}

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


