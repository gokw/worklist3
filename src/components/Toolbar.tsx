// ==============================================================
// ツールバー: 日付移動・仕事/個人モード・表示切替・カテゴリ絞込・各種操作
// ==============================================================
import { useState } from "react";
import type { CategoryGroup, LayoutMode, ViewMode, WorkMode } from "../types";
import { CATEGORY_GROUP_LABELS, WORK_MODE_LABELS } from "../types";
import { formatDateJa, formatMin, todayStr } from "../lib/date";

interface Props {
  selectedDate: string;
  onDateChange: (date: string) => void;
  mode: WorkMode;
  onModeChange: (m: WorkMode) => void;
  categoryModes: Record<string, CategoryGroup>;
  onCategoryModesChange: (m: Record<string, CategoryGroup>) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  layout: LayoutMode;
  onLayoutChange: (l: LayoutMode) => void;
  categories: string[];
  categoryFilter: string;
  onCategoryFilterChange: (c: string) => void;
  showDone: boolean;
  onShowDoneChange: (v: boolean) => void;
  onAdd: () => void;
  onClipboardImport: () => void;
  onRandomStart: () => void;
  onSequentialStart: () => void;
  selectedCount: number;
  onExport: () => void;
  totals: { estimate: number; actual: number; remain: number };
}

const chip = (active: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
    active ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
  }`;

/** モードボタンの色(仕事=青 / 個人=緑 / すべて=グレー) */
const modeChip = (m: WorkMode, active: boolean) => {
  if (!active)
    return "rounded-full px-3 py-1 text-xs font-semibold bg-white text-gray-600 border border-gray-300 hover:bg-gray-100";
  const color =
    m === "work" ? "bg-blue-600" : m === "personal" ? "bg-emerald-600" : "bg-gray-700";
  return `rounded-full px-3 py-1 text-xs font-semibold text-white ${color}`;
};

export default function Toolbar(p: Props) {
  const [assignOpen, setAssignOpen] = useState(false);

  const shiftDate = (days: number) => {
    const d = new Date(p.selectedDate);
    d.setDate(d.getDate() + days);
    p.onDateChange(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  };

  return (
    <div className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
      {/* 1段目: 日付ナビ + 集計 + 主要ボタン */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold text-gray-800">worklist3</h1>

        <div className="flex items-center gap-1">
          <button className={chip(false)} onClick={() => shiftDate(-1)} title="前日(←キー)">
            ◀
          </button>
          <input
            type="date"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={p.selectedDate}
            onChange={(e) => e.target.value && p.onDateChange(e.target.value)}
          />
          <button className={chip(false)} onClick={() => shiftDate(1)} title="翌日(→キー)">
            ▶
          </button>
          {p.selectedDate !== todayStr() && (
            <button className={chip(false)} onClick={() => p.onDateChange(todayStr())}>
              今日へ
            </button>
          )}
          <span className="ml-1 text-sm font-semibold text-gray-700">
            {formatDateJa(p.selectedDate)}
          </span>
        </div>

        <span className="ml-2 text-xs text-gray-500">
          見積 {formatMin(p.totals.estimate) || "0m"} / 実績 {formatMin(p.totals.actual) || "0m"} / 残り{" "}
          {formatMin(p.totals.remain) || "0m"}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={p.onAdd}
            title="ショートカット: N"
          >
            + タスク追加
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={p.onClipboardImport}
            title="クリップボードからTeams/予定/テキストを自動判別して取込(ショートカット: V)"
          >
            📋 取込
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={p.onRandomStart}
            title="今日のタスクからランダムに1件開始"
          >
            🎲
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            disabled={p.selectedCount === 0}
            onClick={p.onSequentialStart}
            title="選択したタスクに、見積を積み上げて連続の開始予定時刻を設定"
          >
            ⏱ 連続時刻 ({p.selectedCount})
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={p.onExport}
            title="全タスクをJSONファイルにバックアップ"
          >
            💾
          </button>
        </div>
      </div>

      {/* 2段目: 仕事/個人モード・表示切替・絞込 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* 仕事/個人モード切替(Mキーでも巡回) */}
        <div className="relative flex items-center gap-1">
          {(["work", "personal", "all"] as WorkMode[]).map((m) => (
            <button
              key={m}
              className={modeChip(m, p.mode === m)}
              onClick={() => p.onModeChange(m)}
              title="仕事/個人モードの切替(Mキーで巡回)"
            >
              {WORK_MODE_LABELS[m]}
            </button>
          ))}
          <button
            className="rounded-full border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
            onClick={() => setAssignOpen((o) => !o)}
            title="カテゴリを仕事/個人に振り分ける設定"
          >
            ⚙
          </button>

          {/* カテゴリ振り分けパネル */}
          {assignOpen && (
            <div className="absolute left-0 top-9 z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700">カテゴリの振り分け</h3>
                <button
                  className="rounded px-1 text-gray-400 hover:bg-gray-100"
                  onClick={() => setAssignOpen(false)}
                >
                  ✕
                </button>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-gray-500">
                各カテゴリをどのモードで表示するか選びます。
                「共通」は仕事・個人どちらでも表示。カテゴリ未設定のタスクは常に表示されます。
              </p>
              {(() => {
                const allCats = [
                  ...new Set([...p.categories, ...Object.keys(p.categoryModes)]),
                ].sort();
                if (allCats.length === 0)
                  return (
                    <p className="text-xs text-gray-400">カテゴリがまだありません</p>
                  );
                return allCats.map((c) => {
                  const current = p.categoryModes[c] ?? "both";
                  return (
                    <div
                      key={c}
                      className="flex items-center justify-between border-t border-gray-100 py-1.5"
                    >
                      <span className="mr-2 truncate text-sm text-gray-700">{c}</span>
                      <span className="flex gap-1">
                        {(["work", "personal", "both"] as CategoryGroup[]).map((g) => (
                          <button
                            key={g}
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              current === g
                                ? g === "work"
                                  ? "bg-blue-600 text-white"
                                  : g === "personal"
                                    ? "bg-emerald-600 text-white"
                                    : "bg-gray-600 text-white"
                                : "border border-gray-300 bg-white text-gray-500 hover:bg-gray-100"
                            }`}
                            onClick={() =>
                              p.onCategoryModesChange({ ...p.categoryModes, [c]: g })
                            }
                          >
                            {CATEGORY_GROUP_LABELS[g]}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        <span className="mx-1 text-gray-300">|</span>

        <div className="flex gap-1">
          <button className={chip(p.viewMode === "dayAll")} onClick={() => p.onViewModeChange("dayAll")}>
            この日のタスクすべて
          </button>
          <button
            className={chip(p.viewMode === "dayPlanned")}
            onClick={() => p.onViewModeChange("dayPlanned")}
          >
            この日の予定のみ
          </button>
          <button
            className={chip(p.viewMode === "everything")}
            onClick={() => p.onViewModeChange("everything")}
          >
            全期間
          </button>
        </div>

        <span className="mx-1 text-gray-300">|</span>

        <div className="flex gap-1">
          <button className={chip(p.layout === "table")} onClick={() => p.onLayoutChange("table")}>
            表形式
          </button>
          <button className={chip(p.layout === "cards")} onClick={() => p.onLayoutChange("cards")}>
            カード形式
          </button>
        </div>

        <span className="mx-1 text-gray-300">|</span>

        <select
          className="rounded border border-gray-300 px-2 py-1 text-xs"
          value={p.categoryFilter}
          onChange={(e) => p.onCategoryFilterChange(e.target.value)}
        >
          <option value="">全カテゴリ</option>
          {p.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={p.showDone}
            onChange={(e) => p.onShowDoneChange(e.target.checked)}
          />
          完了も表示
        </label>
      </div>
    </div>
  );
}
