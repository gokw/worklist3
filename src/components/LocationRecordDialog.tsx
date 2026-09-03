// ==============================================================
// 「ここにいる」記録ダイアログ(Issue #86)
//   📍 を押すと開き、現在地を取得して「ここですか？」と確かめてから記録する。
//   位置は誤差があるうえ屋内では大きく外れるので、確認と手直しの余地を必ず挟む。
//
//   地名は自動では引かない(逆ジオコーディングはAPIキーと費用が要るため)。
//   代わりに「🗺 マップで確認」で開いて、見た地名をその場で入力してもらう。
//
//   コメント欄(#104)は、あとから見返したときに「そこで何をしていたか」を
//   残すためのもの。場所名だけでは足跡にしかならず、記録の値打ちが薄い。
// ==============================================================
import { useEffect, useRef, useState } from "react";
import { type GeoPoint, PIN, formatAccuracy, formatCoords, getCurrentPoint, mapsUrl } from "../lib/geo";

interface Props {
  /** 記録する。タスク名は目印付きで確定済み、コメントは前後の空白を落とした本文 */
  onRecord: (title: string, comment: string, point: GeoPoint) => void;
  onClose: () => void;
}

export default function LocationRecordDialog({ onRecord, onClose }: Props) {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(`${PIN} `);
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** 記録して閉じる。位置が取れるまでは押せない */
  const record = () => {
    if (point) onRecord(title, comment.trim(), point);
  };

  /** 位置を取りに行く。開いた直後と「もう一度」で使う */
  const acquire = () => {
    setError("");
    setPoint(null);
    getCurrentPoint()
      .then(setPoint)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "位置を取得できませんでした"));
  };

  useEffect(() => {
    acquire();
    // 取得を待つ間にも場所名を打ち始められるようにしておく
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(title.length, title.length);
    // 開いたときの1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const acc = point ? formatAccuracy(point.accuracy) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold text-gray-800">📍 ここにいる記録</h2>
        <p className="mb-3 text-xs text-gray-500">
          いまいる場所を、開始も終了もこの時刻で記録します。
        </p>

        {/* 位置の状態 */}
        {!point && !error && (
          <p className="mb-3 rounded bg-gray-50 px-3 py-2 text-sm text-gray-600">
            現在地を取得中…
          </p>
        )}
        {error && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p>⚠ {error}</p>
            <button
              className="mt-1.5 rounded border border-amber-400 px-2 py-0.5 text-xs font-semibold hover:bg-amber-100"
              onClick={acquire}
            >
              もう一度試す
            </button>
          </div>
        )}
        {point && (
          <div className="mb-3 rounded bg-gray-50 px-3 py-2">
            <p className="font-mono text-sm text-gray-700">{formatCoords(point.lat, point.lng)}</p>
            {acc && <p className="mt-0.5 text-xs text-gray-500">精度 {acc}</p>}
            <a
              href={mapsUrl(point.lat, point.lng)}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-sm text-blue-600 underline"
            >
              🗺 マップで確認する
            </a>
          </div>
        )}

        {/* 「ここですか？」= 場所名を確かめて直す */}
        <label className="mb-1 block text-xs text-gray-500">
          場所の名前(空のままなら座標を入れます)
        </label>
        <input
          ref={inputRef}
          type="text"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-2 text-sm"
          placeholder="📍 浅草寺"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") record();
          }}
        />

        {/* コメント(#104)。場所名と同じく Enter でそのまま記録できる */}
        <label className="mb-1 block text-xs text-gray-500">コメント(任意)</label>
        <input
          type="text"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-2 text-sm"
          placeholder="打ち合わせ / 昼食 など"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") record();
          }}
        />

        <div className="flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={!point}
            onClick={record}
          >
            記録する
          </button>
        </div>
      </div>
    </div>
  );
}
