// ==============================================================
// ツールバー: 日付移動・表示切替・カテゴリ絞込・各種操作
// ==============================================================
import type { LayoutMode, ViewMode } from "../types";
import { formatDateJa, formatMin, todayStr } from "../lib/date";

interface Props {
  selectedDate: string;
  onDateChange: (date: string) => void;
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

export default function Toolbar(p: Props) {
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

      {/* 2段目: 表示切替・絞込 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
