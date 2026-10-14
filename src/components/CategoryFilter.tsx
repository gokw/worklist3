// ==============================================================
// 一覧のカテゴリ絞り込み(Issue #133)
//   - 打つと「途中一致」で候補が絞れる。候補から選んだ時点で絞り込みに反映
//   - 打ちかけの文字では絞り込まない(入力中に一覧がちらつかないように)
//   - 空 = 全カテゴリ。選択中は × で全カテゴリへ戻す
//   - ↑↓で候補移動 / Enterで確定(未選択なら先頭候補、空なら全カテゴリ) / Escで取り消し
//   ドロップダウンは position:fixed で表示し、ツールバーの枠で切れないようにする。
// ==============================================================
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as RKE } from "react";
import { matchCategories } from "../lib/logic";

interface Props {
  /** 使用中カテゴリ(文字順) */
  categories: string[];
  /** 絞り込み中のカテゴリ。"" は全カテゴリ */
  value: string;
  onChange: (c: string) => void;
}

export default function CategoryFilter({ categories, value, onChange }: Props) {
  // 入力中の文字。null は「入力していない」(欄には value を出す)
  const [draft, setDraft] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const editing = draft !== null;
  // 開いた直後(選択中の名前のまま)は全件を見せる。打ち始めたら絞る
  const matches = editing && draft !== value ? matchCategories(categories, draft) : categories;

  // ↑↓で動かした候補が見えるようにスクロールを追従させる(先頭の「全カテゴリ」の分 +1)
  useEffect(() => {
    if (highlight < 0) return;
    listRef.current?.children[highlight + 1]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const begin = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom, width: r.width });
    setDraft(value);
    setHighlight(-1);
  };

  const finish = () => {
    setDraft(null);
    setHighlight(-1);
  };

  const choose = (c: string) => {
    onChange(c);
    finish();
    inputRef.current?.blur();
  };

  const handleKey = (e: RKE) => {
    if (!editing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && highlight < matches.length) choose(matches[highlight]);
      else if (draft.trim() === "") choose("");
      else if (draft === value) choose(value);
      else if (matches.length > 0) choose(matches[0]);
      // 一致なしの Enter は何もしない(打ち直せるよう欄は残す)
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish();
      inputRef.current?.blur();
    }
  };

  return (
    <div className="relative flex items-center">
      <input
        ref={inputRef}
        className={`w-40 rounded border py-1 pl-2 pr-6 text-xs ${
          value ? "border-blue-400 bg-blue-50" : "border-gray-300"
        }`}
        placeholder="全カテゴリ"
        value={editing ? draft : value}
        onFocus={(e) => {
          begin();
          e.target.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setHighlight(-1);
        }}
        onKeyDown={handleKey}
        // 候補のクリックは onMouseDown で先に処理するので、blur では取り消すだけ
        onBlur={finish}
        title={"打つと途中一致で候補が絞れます\n候補から選ぶと絞り込み・× で全カテゴリへ"}
      />
      {value && !editing && (
        <button
          type="button"
          className="absolute right-0 flex h-full items-center px-2 text-xs text-gray-400 hover:text-gray-700"
          onClick={() => onChange("")}
          title="全カテゴリに戻す"
          aria-label="カテゴリの絞り込みを解除"
        >
          ×
        </button>
      )}
      {editing && pos && (
        <div
          ref={listRef}
          className="fixed z-[70] max-h-64 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: pos.left, top: pos.top, width: Math.max(pos.width, 192) }}
        >
          <button
            type="button"
            className={`block w-full px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-100 ${
              value === "" ? "font-semibold" : ""
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              choose("");
            }}
          >
            全カテゴリ
          </button>
          {matches.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`block w-full px-2 py-1 text-left text-xs ${
                i === highlight ? "bg-blue-100" : "hover:bg-gray-100"
              } ${c === value ? "font-semibold" : ""}`}
              // onMouseDown: input の blur より先に確定させる
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
            >
              {c}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-2 py-1 text-xs text-gray-400">一致するカテゴリはありません</div>
          )}
        </div>
      )}
    </div>
  );
}
