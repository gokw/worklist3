// ==============================================================
// 時刻入力ミニダイアログ(共有部品)
//   開始/終了など、時刻を入力したい場面で使い回す。
//   - 初期値を渡す(開始予定 or 現在時刻など、呼び出し側で決める)
//   - 手入力: 数字4桁(0930)でも H:MM でもOK(parseTimeInputで正規化)
//   - 「現在時刻」ボタン
//   - 「続き時間」ボタン: その日の最終終了時刻を入れる(渡されたときのみ表示)
// ==============================================================
import { useEffect, useRef, useState } from "react";
import { nowHHMM, parseTimeInput } from "../lib/date";

interface Props {
  title: string;
  message?: string;
  /** 初期表示する時刻(HH:MM)。未指定なら現在時刻 */
  defaultValue?: string;
  /** その日の最終終了時刻(HH:MM)。渡すと「続き時間」ボタンを表示 */
  continuationTime?: string;
  confirmLabel?: string;
  onConfirm: (time: string) => void;
  onClose: () => void;
}

const quickBtn =
  "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100";

export default function TimeInputDialog({
  title,
  message,
  defaultValue,
  continuationTime,
  confirmLabel = "決定",
  onConfirm,
  onClose,
}: Props) {
  const [value, setValue] = useState(defaultValue ?? nowHHMM());
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 開いたら入力欄を全選択して、そのまま4桁打てば上書きできるように
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const parsed = parseTimeInput(value);
    if (!parsed) {
      setError("時刻の形式が正しくありません(例: 0930 または 9:30)");
      return;
    }
    onConfirm(parsed);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xs rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-base font-bold text-gray-800">{title}</h2>
        {message && <p className="mb-2 text-xs text-gray-500">{message}</p>}

        <input
          ref={inputRef}
          className="w-full rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-blue-500 focus:outline-none"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="0930"
          inputMode="numeric"
        />
        {error ? (
          <p className="mt-1 text-[11px] text-red-600">{error}</p>
        ) : (
          <p className="mt-1 text-[11px] text-gray-400">数字4桁(例 0930)または H:MM で入力</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1">
          <button type="button" className={quickBtn} onClick={() => setValue(nowHHMM())}>
            現在時刻
          </button>
          {continuationTime && (
            <button
              type="button"
              className={quickBtn}
              title="その日の最後の終了時刻を入れる"
              onClick={() => setValue(continuationTime)}
            >
              続き時間 ({continuationTime})
            </button>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
