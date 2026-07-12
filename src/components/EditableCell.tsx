// ==============================================================
// インライン編集セル(表のセルをその場で編集する共有部品)
//   - 非編集時: 表示だけ。クリックで編集開始。
//   - 編集時: 種類に応じた入力欄。Enter=確定 / Esc=取消 / Tab=確定して隣へ。
//   - 時刻(time)は数字4桁・コロン不要(TimeField / TimeInputDialog と同じ仕様)。
// ==============================================================
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

export type EditorType = "text" | "number" | "time" | "date" | "select";
export type FinishReason = "exit" | "next" | "prev";

interface Option {
  value: string;
  label: string;
}

interface Props {
  editing: boolean;
  /** キーボードカーソルが乗っているセル(未編集時にハイライト) */
  focused?: boolean;
  /** カーソル移動・スクロール用の項目名 */
  dataField?: string;
  type: EditorType;
  /** 編集開始時の初期文字列(time は数字4桁) */
  editValue: string;
  /** 非編集時の表示内容 */
  display: ReactNode;
  options?: Option[];
  placeholder?: string;
  listId?: string;
  tdClassName: string;
  title?: string;
  onStartEdit: () => void;
  onCommit: (raw: string) => void;
  onFinish: (reason: FinishReason) => void;
  /** 独自エディタ(カテゴリのコンボボックス等)を差し込む場合 */
  renderEditor?: (api: {
    value: string;
    setValue: (v: string) => void;
    commit: (v: string, reason: FinishReason) => void;
    cancel: () => void;
  }) => ReactNode;
}

export default function EditableCell({
  editing,
  focused,
  dataField,
  type,
  editValue,
  display,
  options,
  placeholder,
  listId,
  tdClassName,
  title,
  onStartEdit,
  onCommit,
  onFinish,
  renderEditor,
}: Props) {
  const [text, setText] = useState(editValue);
  const skipBlur = useRef(false);
  const ref = useRef<any>(null);

  // 編集開始のたびに初期値を入れ直し、フォーカス&全選択
  useEffect(() => {
    if (!editing) return;
    setText(editValue);
    skipBlur.current = false;
    if (renderEditor) return; // 独自エディタは自前でフォーカスする
    const el = ref.current;
    if (el) {
      el.focus();
      if (type !== "date" && type !== "select" && typeof el.select === "function") el.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    return (
      <td
        data-field={dataField}
        className={`${tdClassName} cursor-text hover:bg-blue-50 ${
          focused ? "ring-2 ring-inset ring-blue-500" : ""
        }`}
        title={title ?? "クリックで編集"}
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit();
        }}
      >
        {display}
      </td>
    );
  }

  // 独自エディタ(カテゴリのコンボボックス等)
  if (renderEditor) {
    return (
      <td data-field={dataField} className={tdClassName} onClick={(e) => e.stopPropagation()}>
        {renderEditor({
          value: text,
          setValue: setText,
          commit: (v, reason) => {
            skipBlur.current = true;
            onCommit(v);
            onFinish(reason);
          },
          cancel: () => {
            skipBlur.current = true;
            onFinish("exit");
          },
        })}
      </td>
    );
  }

  const commitAndFinish = (reason: FinishReason) => {
    skipBlur.current = true;
    onCommit(text);
    onFinish(reason);
  };

  const handleKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAndFinish("exit");
    } else if (e.key === "Escape") {
      e.preventDefault();
      skipBlur.current = true;
      onFinish("exit");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitAndFinish(e.shiftKey ? "prev" : "next");
    }
  };

  const editorCls =
    "w-full rounded border border-blue-400 bg-white px-1 py-0.5 text-sm outline-none";
  const stop = (e: ReactMouseEvent) => e.stopPropagation();
  const onBlur = () => {
    if (!skipBlur.current) {
      onCommit(text);
      onFinish("exit");
    }
  };

  let editor: ReactNode;
  if (type === "select") {
    editor = (
      <select
        ref={ref}
        className={editorCls}
        value={text}
        onClick={stop}
        onKeyDown={handleKey}
        onBlur={onBlur}
        onChange={(e) => {
          // 選択したら即確定して抜ける
          skipBlur.current = true;
          onCommit(e.target.value);
          onFinish("exit");
        }}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (type === "date") {
    editor = (
      <input
        ref={ref}
        type="date"
        className={editorCls}
        value={text}
        onClick={stop}
        onKeyDown={handleKey}
        onBlur={onBlur}
        onChange={(e) => setText(e.target.value)}
      />
    );
  } else if (type === "time") {
    editor = (
      <input
        ref={ref}
        inputMode="numeric"
        maxLength={4}
        placeholder="0930"
        className={editorCls}
        value={text}
        onClick={stop}
        onKeyDown={handleKey}
        onBlur={onBlur}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
      />
    );
  } else if (type === "number") {
    editor = (
      <input
        ref={ref}
        type="number"
        min={0}
        className={editorCls}
        value={text}
        onClick={stop}
        onKeyDown={handleKey}
        onBlur={onBlur}
        onChange={(e) => setText(e.target.value)}
      />
    );
  } else {
    editor = (
      <input
        ref={ref}
        type="text"
        list={listId}
        placeholder={placeholder}
        className={editorCls}
        value={text}
        onClick={stop}
        onKeyDown={handleKey}
        onBlur={onBlur}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  return (
    <td data-field={dataField} className={tdClassName} onClick={stop}>
      {editor}
    </td>
  );
}
