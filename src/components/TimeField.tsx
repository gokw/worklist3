// ==============================================================
// 4桁時刻入力フィールド(共有部品)
//   コロンを打たずに数字4桁(例 0930)で入力する。
//   内部の値は HH:MM で持ち、表示は4桁(コロンなし)。
//   不正な値(0000〜2359以外)は確定せず赤枠で知らせる。
// ==============================================================
import { useEffect, useState } from "react";
import { parseTimeInput } from "../lib/date";

interface Props {
  /** 現在の値(HH:MM)。未設定は undefined */
  value?: string;
  onChange: (v: string | undefined) => void;
  className?: string;
  placeholder?: string;
}

/** "09:30" → "0930"、undefined → "" */
function toDigits(v?: string): string {
  return v ? v.replace(":", "") : "";
}

export default function TimeField({ value, onChange, className, placeholder = "0930" }: Props) {
  const [text, setText] = useState(toDigits(value));
  const [error, setError] = useState(false);

  // 外部から値が変わったら表示も同期(開始/終了ボタン等で書き換わるケース)
  useEffect(() => {
    setText(toDigits(value));
    setError(false);
  }, [value]);

  const commit = (raw: string) => {
    if (raw === "") {
      setError(false);
      onChange(undefined);
      return;
    }
    const parsed = parseTimeInput(raw);
    if (parsed) {
      setError(false);
      onChange(parsed);
    } else {
      // 不正: 確定せず赤枠で知らせる(0000〜2359以外)
      setError(true);
    }
  };

  return (
    <input
      inputMode="numeric"
      maxLength={4}
      className={`${className ?? ""} ${error ? "border-red-500 bg-red-50" : ""}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        // 数字だけ・最大4桁(コロンは打てない)
        setText(e.target.value.replace(/[^\d]/g, "").slice(0, 4));
        setError(false);
      }}
      onBlur={(e) => commit(e.target.value.replace(/[^\d]/g, ""))}
    />
  );
}
