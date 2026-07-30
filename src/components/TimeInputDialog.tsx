// ==============================================================
// 時刻入力ミニダイアログ(共有部品)
//   開始/終了など、時刻を入力したい場面で使い回す。
//   - 初期値を渡す(開始予定 or 現在時刻など、呼び出し側で決める)
//   - 手入力: 数字4桁(0930)でも H:MM でもOK(parseTimeInputで正規化)
//   - 「現在時刻」ボタンは常設
//   - quickButtons: 呼び出し側が渡す候補ボタン(開始=「続き時間」、終了=「終了予定」等)
//   - クイックボタンは押した瞬間に確定する(値セット＋確定の1タップ。Issue #38 案B)。
//     任意の時刻を入れたいときだけ入力欄に打って Enter / 決定。
// ==============================================================
import { useEffect, useRef, useState } from "react";
import { nowHHMM, parseTimeInput } from "../lib/date";

/** ワンタッチで時刻を入れる候補ボタン */
export interface QuickTime {
  label: string;
  /** セットする時刻(HH:MM) */
  value: string;
}

interface Props {
  title: string;
  message?: string;
  /** 初期表示する時刻(HH:MM)。未指定なら現在時刻 */
  defaultValue?: string;
  /** 「現在時刻」以外に出す候補ボタン(値が空のものは表示しない) */
  quickButtons?: QuickTime[];
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
  quickButtons,
  confirmLabel = "決定",
  onConfirm,
  onClose,
}: Props) {
  // 表示・入力はコロンなしの数字4桁で統一
  const [value, setValue] = useState((defaultValue ?? nowHHMM()).replace(":", ""));
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

  const submit = () => confirmWith(value);

  // クイックボタン用: 値を確定する(1タップで開始/終了まで。Issue #38 案B)
  const confirmWith = (raw: string) => {
    const parsed = parseTimeInput(raw);
    if (!parsed) {
      setError("0000〜2359の数字4桁で入力してください(例: 0930)");
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
          maxLength={4}
          onChange={(e) => {
            // 数字だけ・最大4桁(コロンは打てない)
            setValue(e.target.value.replace(/[^\d]/g, "").slice(0, 4));
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
          <p className="mt-1 text-[11px] text-gray-400">
            数字4桁(例 0930)＋Enter。下のボタンは1タップで確定します
          </p>
        )}

        {/* クイックボタン=押した瞬間に確定(Issue #38 案B) */}
        <div className="mt-3 flex flex-wrap gap-1">
          <button type="button" className={quickBtn} onClick={() => confirmWith(nowHHMM())}>
            現在時刻
          </button>
          {quickButtons
            ?.filter((b) => b.value)
            .map((b) => (
              <button
                key={b.label}
                type="button"
                className={quickBtn}
                onClick={() => confirmWith(b.value)}
              >
                {b.label}
              </button>
            ))}
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
