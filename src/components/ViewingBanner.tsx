// ==============================================================
// 閲覧中の常時バナー(変更仕様書_引き継ぎを3つに分ける.md §4.2/§4.3)
//
//   「見るだけ」は、画面には Drive の内容を出しつつ、この端末に保存されている
//   データには一切触れない。見ているものと保存されているものが食い違う状態を
//   作る以上、それを隠してはいけない。だからこのバナーは常時出す。
//
//   出口は2つ。〔自分のデータに戻す〕と〔編集を有効にする〕。
//   後者では **どちらのデータで続けるかを必ず選ばせる**。ここを既定で流すと、
//   未送信の編集が消える #109 の事故が形を変えて再発する。
// ==============================================================
import { useState } from "react";
import HandoverDialog from "./HandoverDialog";

interface Props {
  /** 何を見ているか(「最新の控え(ミラー)」「2026-09-05」など) */
  label: string;
  /** 見ている控えの件数 */
  count: number;
  /** この端末に保存されている件数 */
  localCount: number;
  /** 手番を取る操作が要る状況か(手番制ONで、この端末が手番を持たない) */
  needsBaton: boolean;
  /** 閲覧をやめて自分のデータへ戻す */
  onExit: () => void;
  /** 手番が要らない場合の「編集を有効にする」(自分のデータへ戻すだけ) */
  onEditHere: () => void;
  /** 上書き前のミラーを退避する */
  onSnapshot: () => Promise<string>;
  /** いま見ている内容で続ける(それを手元にして手番を取る) */
  onAdoptViewed: () => Promise<void>;
  /** この端末のデータに戻して続ける(手元のまま手番を取る) */
  onKeepLocal: () => Promise<void>;
}

type Choice = "viewed" | "local" | null;

export default function ViewingBanner(p: Props) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>(null);

  const close = () => {
    setChoice(null);
    setChooserOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        <span className="font-semibold">👁 Drive の内容を見ています</span>
        <span>
          {p.label}／{p.count}件
        </span>
        <span className="text-sky-700">
          この端末に保存されているデータは変えていません（{p.localCount}件）
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={p.onExit}
            className="rounded border border-sky-600 bg-white px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
          >
            自分のデータに戻す
          </button>
          <button
            type="button"
            onClick={() => (p.needsBaton ? setChooserOpen(true) : p.onEditHere())}
            className="rounded border border-sky-300 bg-white px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-100"
          >
            編集を有効にする
          </button>
        </div>
      </div>

      {/* §4.2.1 どちらのデータで続けるかを必ず選ばせる */}
      {chooserOpen && !choice && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onMouseDown={close}
        >
          <div
            className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-bold text-gray-800">
              どちらのデータで編集を始めますか？
            </h2>

            <div className="space-y-3">
              <button
                type="button"
                className="block w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-left hover:bg-blue-100"
                onClick={() => setChoice("viewed")}
              >
                <p className="text-sm font-semibold text-blue-800">
                  いま見ている内容で続ける（{p.count}件）
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  この端末のデータ（{p.localCount}件）は、見ている内容で置き換わります。
                </p>
              </button>

              <button
                type="button"
                className="block w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-100"
                onClick={() => setChoice("local")}
              >
                <p className="text-sm font-semibold text-amber-900">
                  この端末のデータに戻して続ける（{p.localCount}件）
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  いま見ていた内容は破棄します。Drive 側は、この端末の内容で上書きされます。
                </p>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                onClick={close}
              >
                やめる (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* どちらを選んでも Drive 側を上書きするので、退避を必ず通す */}
      {choice && (
        <HandoverDialog
          title={
            choice === "viewed" ? "見ている内容で編集を始める" : "この端末のデータで編集を始める"
          }
          description={
            choice === "viewed" ? (
              <>
                いま見ている <b>{p.label}</b> の内容を、この端末のデータにして更新側になります。
              </>
            ) : (
              <>
                いま見ていた内容は破棄し、<b>この端末のデータ</b>で更新側になります。
              </>
            )
          }
          rows={[
            {
              label: "編集を始める内容",
              value: `${choice === "viewed" ? p.count : p.localCount}件`,
              strong: true,
            },
            {
              label: "破棄する方",
              value: `${choice === "viewed" ? `この端末の${p.localCount}件` : `見ていた${p.count}件`}`,
            },
          ]}
          danger="Drive 側の内容は、ここで選んだ内容で上書きされます。他の端末でしか行っていない変更があれば、それは失われます。"
          confirmLabel="この内容で始める"
          onSnapshot={p.onSnapshot}
          onClose={close}
          onConfirm={async () => {
            await (choice === "viewed" ? p.onAdoptViewed() : p.onKeepLocal());
            close();
          }}
        />
      )}
    </>
  );
}
