// ==============================================================
// 表形式ビュー(Excel版 worklist の列構成を踏襲)
//   よく直す列はセルをクリックしてその場で編集(インライン編集)。
//   メモ/リンク/繰り返し等の詳細は ✎ / Enter / 詳細ダイアログで編集する。
//   dense=true は「表形式ライト」(Issue #10): Excel並みの高密度表示。
//     行高を約2/3に・見出しを圧縮・記号化・等幅数字で桁揃え・操作はアイコンのみ。
// ==============================================================
import type { ReactNode } from "react";
import type { Importance, Task } from "../types";
import { ALL_IMPORTANCES, DERIVED_STATUS_LABELS, REPEAT_UNIT_LABELS } from "../types";
import { formatDateJa, parseTimeInput } from "../lib/date";
import { actMin, collectCategories, derivedStatus, planEnd } from "../lib/logic";
import TaskActions, { type TaskActionHandlers } from "./TaskActions";
import EditableCell, { type FinishReason } from "./EditableCell";
import CategoryInput from "./CategoryInput";
import {
  deadlineTextClass,
  importanceBadgeClass,
  statusBadgeClass,
  taskBgClass,
} from "./rowStyle";

/** インライン編集できる項目(Tab移動・カーソル左右の並び順もこの順) */
export type EditableField =
  | "date"
  | "title"
  | "importance"
  | "estimateMin"
  | "planStart"
  | "actStart"
  | "actEnd"
  | "deadline"
  | "category";

// 列の視覚順に合わせる(Issue #11: 重要度はタスク名より前)
export const EDIT_ORDER: EditableField[] = [
  "date",
  "importance",
  "title",
  "estimateMin",
  "planStart",
  "actStart",
  "actEnd",
  "deadline",
  "category",
];

/** 表の編集中セル(行ID＋項目) */
export type EditingCell = { id: string; field: EditableField } | null;

interface Props extends TaskActionHandlers {
  tasks: Task[];
  /** 選択中のタスクID(選択した順) */
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  /** Shift+クリックの範囲選択(基準行〜クリック行)。Issue #8 */
  onRangeSelectTo: (id: string) => void;
  /** 待ちフラグのトグル(完了タスクは待ちタスクとして複製) */
  onToggleWait: (task: Task) => void;
  /** インライン編集の結果を保存 */
  onUpdateTask: (task: Task) => void;
  /** キーボードカーソル位置のタスクID */
  focusedId: string | null;
  /** キーボードカーソルの列(Excel風セル移動)。null=列未選択 */
  focusedField: EditableField | null;
  /** セルへフォーカス(行ID＋項目を同時に更新) */
  onFocusCell: (id: string, field: EditableField) => void;
  onFocusTask: (id: string) => void;
  /** 編集中セル(App が保持し、キーボードからも開始できるよう制御化) */
  editing: EditingCell;
  onEditingChange: (e: EditingCell) => void;
  /** 表形式ライト(高密度)。Issue #10 */
  dense?: boolean;
}

// 見出し(dense はExcel流に圧縮)。並びは Issue #11:
//   日付、区分、状態、重要度、繰返、タスク名、見積、予定、終予、開始、終了、実績、期限、分類
//   (「残り」は隠しカラムとして表示しない)
const HEADERS_NORMAL = ["", "日付", "区分", "ステータス", "重要度", "繰返", "タスク名", "見積", "開始予定", "終了予定", "開始", "終了", "実績", "期限", "カテゴリ", "操作"] as const;
const HEADERS_DENSE = ["", "日付", "区", "状", "重", "繰", "タスク名", "見", "予定", "終予", "開始", "終了", "実", "期限", "分類", ""] as const;

// 列幅(px)。タスク名(TITLE_COL)は undefined=可変で残り幅を独占し、
// ウィンドウ幅いっぱいまで自動で伸びる(横スクロールは最低幅を下回るときだけ)。
const COLW_DENSE:  (number | undefined)[] = [28, 56, 20, 22, 22, 22, undefined, 34, 46, 46, 46, 46, 34, 56, 84, 96];
const COLW_NORMAL: (number | undefined)[] = [40, 78, 40, 68, 48, 84, undefined, 52, 72, 72, 60, 60, 48, 78, 116, 210];
/** タスク名列のインデックス(チェックボックス列含む) */
const TITLE_COL = 6;
/** タスク名列の最低幅。表全体の最低幅 = 固定列合計 + これ。これを下回ると横スクロール */
const TITLE_MIN_DENSE = 180;
const TITLE_MIN_NORMAL = 220;

function repeatLabel(task: Task): string {
  if (!task.repeat) return "";
  const r = task.repeat;
  // 0日ごと = 1日に何度でも(メール確認など)。「毎0日」だと分かりにくいので専用表記にする
  if (r.unit === "day" && r.interval === 0) {
    return r.mode === "afterComplete" ? "完了後すぐ" : "随時(何度も)";
  }
  const base = `${r.interval}${REPEAT_UNIT_LABELS[r.unit]}`;
  const wd =
    r.unit === "week" && r.weekdays?.length
      ? `(${r.weekdays.map((w) => ["日", "月", "火", "水", "木", "金", "土"][w]).join("")})`
      : "";
  return r.mode === "afterComplete" ? `完了+${base}` : `毎${base}${wd}`;
}

/** 編集開始時に入力欄へ入れる文字列 */
function editValueOf(task: Task, field: EditableField): string {
  switch (field) {
    case "date":
      return task.date ?? "";
    case "title":
      return task.title;
    case "importance":
      return task.importance;
    case "estimateMin":
      return String(task.estimateMin ?? 0);
    case "planStart":
      return (task.planStart ?? "").replace(":", "");
    case "actStart":
      return (task.actStart ?? "").replace(":", "");
    case "actEnd":
      return (task.actEnd ?? "").replace(":", "");
    case "deadline":
      return task.deadline ?? "";
    case "category":
      return task.category;
  }
}

/** 入力文字列からタスクへの変更点を作る。null なら変更なし(不正値等) */
function patchOf(task: Task, field: EditableField, raw: string): Partial<Task> | null {
  switch (field) {
    case "title": {
      const v = raw.trim();
      return v && v !== task.title ? { title: v } : null; // 空は無視
    }
    case "category":
      return { category: raw.trim() };
    case "importance":
      return { importance: raw as Importance };
    case "estimateMin":
      return { estimateMin: Math.max(0, Math.floor(Number(raw) || 0)) };
    case "date":
      return { date: raw || undefined };
    case "deadline":
      return { deadline: raw || undefined };
    case "planStart":
    case "actStart":
    case "actEnd": {
      if (raw === "") return { [field]: undefined } as Partial<Task>;
      const p = parseTimeInput(raw);
      return p ? ({ [field]: p } as Partial<Task>) : null; // 不正な時刻は変更しない
    }
  }
}

export default function TaskTable({
  tasks,
  selectedIds,
  onToggleSelect,
  onRangeSelectTo,
  onToggleWait,
  onUpdateTask,
  focusedId,
  focusedField,
  onFocusCell,
  onFocusTask,
  editing,
  onEditingChange,
  dense = false,
  ...handlers
}: Props) {
  // 密度でクラスを切替(通常: 余白広め / ライト: Excel並みの詰め込み)
  const th = dense
    ? "border-b border-gray-300 bg-gray-700 px-1 py-0.5 text-left text-[11px] font-semibold text-white whitespace-nowrap"
    : "border-b border-gray-300 bg-gray-700 px-2 py-1.5 text-left text-xs font-semibold text-white whitespace-nowrap";
  const td = dense
    ? "border-b border-gray-100 px-1 py-0 text-xs leading-[1.6] whitespace-nowrap"
    : "border-b border-gray-200 px-2 py-1 text-sm whitespace-nowrap";
  // 時刻・数値列は等幅数字で桁を揃える(視認性の要)
  const tdTime = `${td} tabular-nums`;
  const tdNum = `${td} text-right tabular-nums`;
  const editorCls = dense
    ? "w-full rounded border border-blue-400 bg-white px-1 py-0 text-xs outline-none"
    : undefined;
  const headers = dense ? HEADERS_DENSE : HEADERS_NORMAL;

  const startEdit = (id: string, field: EditableField) => {
    onFocusCell(id, field);
    onEditingChange({ id, field });
  };

  const commit = (task: Task, field: EditableField, raw: string) => {
    const patch = patchOf(task, field, raw);
    if (patch) onUpdateTask({ ...task, ...patch, updatedAt: new Date().toISOString() });
  };

  const finish = (id: string, field: EditableField, reason: FinishReason) => {
    if (reason === "exit") {
      onEditingChange(null);
      onFocusCell(id, field); // 編集を抜けてもそのセルにカーソルを残す
      return;
    }
    const idx = EDIT_ORDER.indexOf(field);
    const nextIdx = reason === "next" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= EDIT_ORDER.length) {
      onEditingChange(null);
      onFocusCell(id, field);
    } else {
      const nextField = EDIT_ORDER[nextIdx];
      onEditingChange({ id, field: nextField });
      onFocusCell(id, nextField);
    }
  };

  // 使用中カテゴリ(文字順)。インライン候補に使う
  const categories = collectCategories(tasks);

  /** editableなセルを描く小ヘルパー */
  const cell = (
    task: Task,
    field: EditableField,
    type: "text" | "number" | "time" | "date" | "select",
    display: ReactNode,
    extra?: {
      tdClass?: string;
      options?: { value: string; label: string }[];
      placeholder?: string;
      renderEditor?: (api: {
        value: string;
        setValue: (v: string) => void;
        commit: (v: string, reason: FinishReason) => void;
        cancel: () => void;
      }) => ReactNode;
    }
  ) => (
    <EditableCell
      editing={editing?.id === task.id && editing.field === field}
      focused={
        focusedId === task.id &&
        focusedField === field &&
        !(editing?.id === task.id && editing.field === field)
      }
      dataField={field}
      type={type}
      editValue={editValueOf(task, field)}
      display={display}
      options={extra?.options}
      placeholder={extra?.placeholder}
      renderEditor={extra?.renderEditor}
      tdClassName={extra?.tdClass ?? td}
      editorClassName={editorCls}
      onStartEdit={() => startEdit(task.id, field)}
      onCommit={(raw) => commit(task, field, raw)}
      onFinish={(reason) => finish(task.id, field, reason)}
    />
  );

  if (tasks.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-gray-400">
        表示するタスクがありません。「N」キーまたは「+ タスク追加」で書き出しを始めましょう。
      </p>
    );
  }

  // タスク名(TITLE_COL)は幅未指定=残り幅を独占して自動で伸びる。
  // 表の最低幅 = 固定列合計 + タスク名の最低幅。ウィンドウがこれを下回ると横スクロール。
  const colw = dense ? COLW_DENSE : COLW_NORMAL;
  const fixedSum = colw.reduce<number>((s, w, i) => (i === TITLE_COL ? s : s + (w ?? 0)), 0);
  const minTableW = fixedSum + (dense ? TITLE_MIN_DENSE : TITLE_MIN_NORMAL);

  return (
    // ヘッダー固定のため、この枠内で縦横スクロールさせる(画面高いっぱい)
    <div className="max-h-[calc(100vh-8.5rem)] overflow-auto rounded border border-gray-300 shadow-sm">
      <table
        className="w-full table-fixed border-collapse bg-white"
        style={{ minWidth: minTableW }}
      >
        <colgroup>
          {colw.map((w, i) => (
            <col key={i} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={`${th} sticky top-0 z-10`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t, i) => {
            const act = actMin(t);
            const focused = t.id === focusedId;
            const st = derivedStatus(t);
            // 次の行と日付が違えば、この行の下端に濃い実線を引いて日付の境目を示す。
            // box-shadowはborder-collapseの影響を受けず<tr>にそのまま効くのでこちらを使う。
            const nextTask = tasks[i + 1];
            const isDateBoundary = !!nextTask && (nextTask.date ?? "") !== (t.date ?? "");
            return (
              <tr
                key={t.id}
                data-task-id={t.id}
                onClick={() => onFocusTask(t.id)}
                // 編集不可の場所をダブルクリックすると詳細ダイアログ
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, input, select, a, textarea")) return;
                  handlers.onEdit(t);
                }}
                className={`${taskBgClass(t)} hover:brightness-95 ${
                  isDateBoundary ? "shadow-[inset_0_-2px_0_0_#9ca3af]" : ""
                } ${focused ? "outline outline-2 -outline-offset-2 outline-blue-600" : ""}`}
              >
                <td className={td}>
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      className={dense ? "h-3 w-3" : ""}
                      checked={selectedIds.includes(t.id)}
                      onChange={() => {}}
                      // 選択は onClick で自前処理(既定トグルは止めて二重処理を防ぐ)
                      // Shift+クリック=範囲選択 / 通常クリック=トグル
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (e.shiftKey) onRangeSelectTo(t.id);
                        else onToggleSelect(t.id);
                      }}
                      title="クリックで選択 / Shift+クリックで範囲選択"
                    />
                    {selectedIds.includes(t.id) && (
                      <span
                        className={`inline-flex items-center justify-center rounded-full bg-blue-600 font-bold text-white ${
                          dense ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]"
                        }`}
                      >
                        {selectedIds.indexOf(t.id) + 1}
                      </span>
                    )}
                  </span>
                </td>

                {/* 日付(インライン) */}
                {cell(t, "date", "date", t.date ? formatDateJa(t.date) : "毎日", {
                  tdClass: tdTime,
                })}

                {/* 区分(仕事/個人)は編集不可 */}
                <td className={`${td} text-center`} title={t.scope === "work" ? "仕事" : "個人"}>
                  {t.scope === "work" ? "💼" : "🏠"}
                </td>

                {/* ステータス(待ちトグル)。ライトは1文字 */}
                <td className={td}>
                  <button
                    className={`rounded font-semibold ${statusBadgeClass(st)} ${
                      dense ? "px-1 text-[11px] leading-tight" : "px-2 py-0.5 text-xs"
                    }`}
                    title={
                      `${DERIVED_STATUS_LABELS[st]} — ` +
                      (t.actEnd
                        ? "クリックで待ちタスクとして複製(Wキー)"
                        : "クリックで待ちON/OFF(Wキー)")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWait(t);
                    }}
                  >
                    {dense ? DERIVED_STATUS_LABELS[st].charAt(0) : DERIVED_STATUS_LABELS[st]}
                  </button>
                </td>

                {/* 重要度(インライン・セレクト)。Issue #11: 繰返より前 */}
                {cell(
                  t,
                  "importance",
                  "select",
                  <span
                    className={`inline-block rounded text-center font-bold ${importanceBadgeClass(t.importance)} ${
                      dense ? "w-4 text-[11px] leading-tight" : "w-6 text-xs"
                    }`}
                  >
                    {t.importance}
                  </span>,
                  { options: ALL_IMPORTANCES.map((i) => ({ value: i, label: i })) }
                )}

                {/* 繰返(編集不可・詳細で)。ライトは🔁アイコン+ツールチップ */}
                {dense ? (
                  <td className={`${td} text-center`} title={repeatLabel(t)}>
                    {t.repeat ? "🔁" : ""}
                  </td>
                ) : (
                  <td className={`${td} text-xs text-gray-500`}>{repeatLabel(t)}</td>
                )}

                {/* タスク名(インライン)。必ず1行に切り詰め、溢れはホバーで全文 */}
                {cell(
                  t,
                  "title",
                  "text",
                  <span className="flex w-full min-w-0 items-center" title={t.title}>
                    <span className={`min-w-0 truncate ${t.actEnd ? "line-through" : ""}`}>
                      {t.parentId && <span className="text-gray-400">└ </span>}
                      {t.title || <span className="text-gray-300">(無題)</span>}
                    </span>
                    {t.links.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 shrink-0 text-blue-500 hover:underline"
                        title={url}
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗
                      </a>
                    ))}
                    {t.memos.some((m) => m) && (
                      <span
                        className="ml-1 shrink-0 cursor-help text-gray-400"
                        title={t.memos.filter(Boolean).join("\n")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        📝
                      </span>
                    )}
                  </span>,
                  { tdClass: `${td} overflow-hidden`, placeholder: "タスク名" }
                )}

                {/* 見積(インライン・数値) */}
                {cell(t, "estimateMin", "number", t.estimateMin || "", { tdClass: tdNum })}

                {/* 開始予定(インライン・4桁) */}
                {cell(t, "planStart", "time", t.planStart ?? "", { tdClass: tdTime })}

                {/* 終了予定(計算・編集不可) */}
                <td className={`${tdTime} text-gray-500`}>{planEnd(t) ?? ""}</td>

                {/* 開始実績/終了実績(インライン・4桁) */}
                {cell(t, "actStart", "time", t.actStart ?? "", { tdClass: tdTime })}
                {cell(t, "actEnd", "time", t.actEnd ?? "", { tdClass: tdTime })}

                {/* 実績(計算・編集不可)。「残り」は隠しカラム(Issue #11) */}
                <td className={`${tdNum} text-gray-500`}>{act ?? ""}</td>

                {/* 期限(インライン) */}
                {cell(t, "deadline", "date", t.deadline ? formatDateJa(t.deadline) : "", {
                  tdClass: `${tdTime} ${deadlineTextClass(t)}`,
                })}

                {/* カテゴリ(インライン・前方一致コンボボックス) */}
                {cell(t, "category", "text", t.category, {
                  renderEditor: (api) => (
                    <CategoryInput
                      value={api.value}
                      categories={categories}
                      onChange={api.setValue}
                      onCommit={(v) => api.commit(v, "exit")}
                      onTab={(shift, v) => api.commit(v, shift ? "prev" : "next")}
                      onCancel={api.cancel}
                      autoFocus
                      placeholder="運用業務 等"
                      className={
                        editorCls ??
                        "w-full rounded border border-blue-400 bg-white px-1 py-0.5 text-sm outline-none"
                      }
                    />
                  ),
                })}

                {/* 操作 */}
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <TaskActions task={t} compact={dense} {...handlers} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
