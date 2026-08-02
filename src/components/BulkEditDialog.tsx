// ==============================================================
// 一括編集ダイアログ(Issue #3)
//   選択した複数タスクに、チェックした項目だけをまとめて適用する。
//   対象: 日付 / 期限 / カテゴリ / 重要度 / 区分(仕事・個人)
//   日付は「指定日にセット」または「前日/翌日/今日にずらす」。
// ==============================================================
import { useEffect, useState } from "react";
import type { Importance, TaskScope } from "../types";
import { ALL_IMPORTANCES, SCOPE_LABELS } from "../types";
import CategoryInput from "./CategoryInput";

/** 日付の変更方法 */
export type DateChange =
  | { kind: "set"; value?: string } // 指定日(空=毎日にする)
  | { kind: "shift"; by: number | "today" }; // 前日(-1)/翌日(+1)/今日

/** 変更する項目だけを持つ差分。キーがあれば「その項目を変更する」 */
export interface BulkChanges {
  date?: DateChange;
  deadline?: { value?: string }; // value 空=期限クリア
  category?: string;
  importance?: Importance;
  scope?: TaskScope;
}

interface Props {
  count: number;
  categories: string[];
  onApply: (changes: BulkChanges) => void;
  onClose: () => void;
}

const labelCls = "text-sm font-semibold text-gray-700";
const inputCls =
  "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";

export default function BulkEditDialog({ count, categories, onApply, onClose }: Props) {
  const [dateOn, setDateOn] = useState(false);
  const [dateMode, setDateMode] = useState<"set" | "shift">("set");
  const [dateValue, setDateValue] = useState("");
  const [dateShift, setDateShift] = useState<number | "today">(1);

  const [deadlineOn, setDeadlineOn] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState("");

  const [catOn, setCatOn] = useState(false);
  const [catValue, setCatValue] = useState("");

  const [impOn, setImpOn] = useState(false);
  const [impValue, setImpValue] = useState<Importance>("C");

  const [scopeOn, setScopeOn] = useState(false);
  const [scopeValue, setScopeValue] = useState<TaskScope>("work");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const anyOn = dateOn || deadlineOn || catOn || impOn || scopeOn;

  const apply = () => {
    const changes: BulkChanges = {};
    if (dateOn)
      changes.date =
        dateMode === "set"
          ? { kind: "set", value: dateValue || undefined }
          : { kind: "shift", by: dateShift };
    if (deadlineOn) changes.deadline = { value: deadlineValue || undefined };
    if (catOn) changes.category = catValue.trim();
    if (impOn) changes.importance = impValue;
    if (scopeOn) changes.scope = scopeValue;
    onApply(changes);
  };

  const shiftBtn = (label: string, val: number | "today") => (
    <button
      type="button"
      onClick={() => setDateShift(val)}
      className={`rounded px-3 py-1 text-sm font-semibold ${
        dateShift === val
          ? "bg-blue-600 text-white"
          : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-8 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-bold text-gray-800">一括編集</h2>
        <p className="mb-3 text-xs text-gray-500">
          選択した <b className="text-gray-700">{count}</b> 件に、チェックした項目だけを適用します。
        </p>

        <div className="space-y-2">
          {/* 日付 */}
          <div className="rounded border border-gray-200 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={dateOn} onChange={(e) => setDateOn(e.target.checked)} />
              <span className={labelCls}>日付</span>
            </label>
            {dateOn && (
              <div className="mt-2 space-y-2 pl-6">
                <div className="flex gap-4 text-sm text-gray-700">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={dateMode === "set"} onChange={() => setDateMode("set")} />
                    指定日にセット
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={dateMode === "shift"} onChange={() => setDateMode("shift")} />
                    ずらす
                  </label>
                </div>
                {dateMode === "set" ? (
                  <div>
                    <input
                      type="date"
                      className={`${inputCls} max-w-[12rem]`}
                      value={dateValue}
                      onChange={(e) => setDateValue(e.target.value)}
                    />
                    <p className="mt-0.5 text-[11px] text-gray-400">空欄で「毎日(日付なし)」にします</p>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    {shiftBtn("前日", -1)}
                    {shiftBtn("翌日", 1)}
                    {shiftBtn("今日", "today")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 期限 */}
          <div className="rounded border border-gray-200 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deadlineOn} onChange={(e) => setDeadlineOn(e.target.checked)} />
              <span className={labelCls}>期限</span>
            </label>
            {deadlineOn && (
              <div className="mt-2 pl-6">
                <input
                  type="date"
                  className={`${inputCls} max-w-[12rem]`}
                  value={deadlineValue}
                  onChange={(e) => setDeadlineValue(e.target.value)}
                />
                <p className="mt-0.5 text-[11px] text-gray-400">空欄で期限をクリアします</p>
              </div>
            )}
          </div>

          {/* カテゴリ */}
          <div className="rounded border border-gray-200 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={catOn} onChange={(e) => setCatOn(e.target.checked)} />
              <span className={labelCls}>カテゴリ</span>
            </label>
            {catOn && (
              <div className="mt-2 max-w-xs pl-6">
                <CategoryInput
                  value={catValue}
                  categories={categories}
                  onChange={setCatValue}
                  className={inputCls}
                  placeholder="運用業務 等(空欄でクリア)"
                />
              </div>
            )}
          </div>

          {/* 重要度 */}
          <div className="rounded border border-gray-200 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={impOn} onChange={(e) => setImpOn(e.target.checked)} />
              <span className={labelCls}>重要度</span>
            </label>
            {impOn && (
              <div className="mt-2 pl-6">
                <select
                  className={`${inputCls} max-w-[8rem]`}
                  value={impValue}
                  onChange={(e) => setImpValue(e.target.value as Importance)}
                >
                  {ALL_IMPORTANCES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 区分(仕事/個人) */}
          <div className="rounded border border-gray-200 p-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={scopeOn} onChange={(e) => setScopeOn(e.target.checked)} />
              <span className={labelCls}>仕事 / 個人</span>
            </label>
            {scopeOn && (
              <div className="mt-2 flex gap-1 pl-6">
                {(["work", "personal"] as TaskScope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScopeValue(s)}
                    className={`rounded px-4 py-1 text-sm font-semibold ${
                      scopeValue === s
                        ? s === "work"
                          ? "bg-blue-600 text-white"
                          : "bg-emerald-600 text-white"
                        : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {s === "work" ? "💼 " : "🏠 "}
                    {SCOPE_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            disabled={!anyOn}
            onClick={apply}
          >
            {count}件に適用
          </button>
        </div>
      </div>
    </div>
  );
}
