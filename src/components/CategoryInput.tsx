// ==============================================================
// カテゴリ入力コンボボックス(Issue #2)
//   - 手入力で「前方一致」インクリメンタルサーチ
//   - 候補は文字順(呼び出し側で整列済みを渡す)
//   - 無ければ新規カテゴリとしてそのまま入力できる
//   - ↑↓で候補移動 / Enterで確定 / Escで閉じる
//   - onCommit を渡すとインライン編集モード(Enter=確定 / Tab=隣へ)
//   ドロップダウンは position:fixed で表示し、表のスクロール枠でも切れないようにする。
// ==============================================================
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as RKE } from "react";

interface Props {
  value: string;
  /** 使用中カテゴリ(文字順) */
  categories: string[];
  onChange: (v: string) => void;
  /** インライン編集で確定するとき(Enter/候補選択/blur) */
  onCommit?: (v: string) => void;
  onCancel?: () => void;
  onTab?: (shift: boolean, v: string) => void;
  /** ユーザーが触れたことの通知(自動推測の停止用) */
  onTouch?: () => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

export default function CategoryInput({
  value,
  categories,
  onChange,
  onCommit,
  onCancel,
  onTab,
  onTouch,
  autoFocus,
  className,
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inline = !!onCommit;

  const q = value.trim();
  // 前方一致(自分自身と同じ文字列は除く)。空なら全件
  const matches =
    q === "" ? categories : categories.filter((c) => c.startsWith(q) && c !== q);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [autoFocus]);

  const openList = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom, width: r.width });
    setOpen(true);
  };

  const close = () => setOpen(false);

  const choose = (c: string) => {
    onChange(c);
    close();
    if (inline) onCommit!(c);
  };

  const handleKey = (e: RKE) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      // Ctrl/⌘+Enter はフォーム保存に通すため、ここでは拾わない
      e.preventDefault();
      const chosen = highlight >= 0 && highlight < matches.length ? matches[highlight] : value;
      onChange(chosen);
      close();
      if (inline) onCommit!(chosen);
    } else if (e.key === "Tab" && inline) {
      e.preventDefault();
      const chosen = highlight >= 0 && highlight < matches.length ? matches[highlight] : value;
      onChange(chosen);
      close();
      onTab?.(e.shiftKey, chosen);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      } else {
        onCancel?.();
      }
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onTouch?.();
          onChange(e.target.value);
          setHighlight(-1);
          openList();
        }}
        onFocus={() => {
          onTouch?.();
          openList();
        }}
        onKeyDown={handleKey}
        onBlur={() => {
          // 候補クリック(onMouseDown)を先に処理させるため少し待つ
          setTimeout(() => {
            close();
            if (inline) onCommit?.(value);
          }, 120);
        }}
      />
      {open && matches.length > 0 && pos && (
        <div
          className="fixed z-[70] max-h-52 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: pos.left, top: pos.top, width: Math.max(pos.width, 128) }}
        >
          {matches.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`block w-full px-2 py-1 text-left text-sm ${
                i === highlight ? "bg-blue-100" : "hover:bg-gray-100"
              }`}
              // onMouseDown: input の blur より先に確定させる
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
