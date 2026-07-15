// ==============================================================
// ツールバー: 日付移動・仕事/個人モード・表示切替・カテゴリ絞込・各種操作
// ==============================================================
import { useRef, useState } from "react";
import type { LayoutMode, ViewMode, WorkMode } from "../types";
import { LAYOUT_LABELS, VIEW_MODE_LABELS, WORK_MODE_LABELS } from "../types";
import { formatDateJa, formatMin, todayStr } from "../lib/date";
import type { BackupState } from "../lib/backup";

/** ドロップダウン(その他)にまとめるビュー */
const DROPDOWN_VIEWS: ViewMode[] = ["today", "done", "everything"];

interface Props {
  selectedDate: string;
  onDateChange: (date: string) => void;
  mode: WorkMode;
  onModeChange: (m: WorkMode) => void;
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
  onBulkAdd: () => void;
  onRandomStart: () => void;
  onSequentialStart: () => void;
  onBulkEdit: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  selectedCount: number;
  onExport: () => void;
  /** JSONファイルからの一括インポート(Issue #12) */
  onImportFile: (file: File) => void;
  /** 同期フォルダへの自動バックアップの状態 */
  backup: BackupState;
  onChooseBackupDir: () => void;
  onReconnectBackupDir: () => void;
  onDisconnectBackupDir: () => void;
  onBackupNow: () => void;
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
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropdownActive = DROPDOWN_VIEWS.includes(p.viewMode);

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

        {/* 日付ナビは「今日」ビューのときだけ(特定日を見る用) */}
        {p.viewMode === "today" && (
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
              {p.selectedDate === todayStr() ? "今日" : formatDateJa(p.selectedDate)}
            </span>
          </div>
        )}

        <span className="ml-2 text-xs text-gray-500">
          見積 {formatMin(p.totals.estimate) || "0m"} / 実績 {formatMin(p.totals.actual) || "0m"} / 残り{" "}
          {formatMin(p.totals.remain) || "0m"}
        </span>

        <div className="relative ml-auto flex flex-wrap items-center gap-2">
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
            onClick={p.onBulkAdd}
            title="テキストを貼り付けて複数タスクを一括登録"
          >
            📥 一括登録
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
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:border-gray-300 disabled:bg-white disabled:text-gray-400"
            disabled={p.selectedCount === 0}
            onClick={p.onBulkEdit}
            title="選択したタスクの項目(日付・期限・カテゴリ・重要度・区分)をまとめて変更"
          >
            ✏️ 一括編集 ({p.selectedCount})
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => setDataMenuOpen((o) => !o)}
            title="データのエクスポート/インポート"
          >
            💾 ▾
          </button>
          {/* データメニュー(エクスポート/インポート/自動バックアップ)。Issue #12 */}
          {dataMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDataMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    p.onExport();
                    setDataMenuOpen(false);
                  }}
                >
                  ⬇ エクスポート(JSONを保存)
                </button>
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => fileRef.current?.click()}
                >
                  ⬆ インポート(JSONを読込)
                </button>

                <div className="my-1 border-t border-gray-200" />
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-gray-400">
                  自動バックアップ
                </div>

                {!p.backup.supported ? (
                  <p className="px-3 pb-2 text-xs text-gray-500">
                    この機能は Chrome / Edge でのみ使えます
                  </p>
                ) : !p.backup.connected ? (
                  <>
                    {/* 権限切れ: 保存済みのフォルダがあるので、選び直さず再接続だけで戻せる */}
                    {p.backup.needsReconnect && (
                      <button
                        className="block w-full px-3 py-1.5 text-left text-sm font-semibold text-amber-700 hover:bg-amber-50"
                        onClick={() => {
                          p.onReconnectBackupDir();
                          setDataMenuOpen(false);
                        }}
                      >
                        🔄 バックアップ先を再接続{p.backup.dirName && `: ${p.backup.dirName}`}
                      </button>
                    )}
                    <button
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        p.onChooseBackupDir();
                        setDataMenuOpen(false);
                      }}
                    >
                      📁 バックアップ先フォルダを{p.backup.needsReconnect ? "選び直す" : "選択"}
                    </button>
                    <p
                      className={`px-3 pb-2 text-xs ${
                        p.backup.problem ? "text-amber-700" : "text-gray-500"
                      }`}
                    >
                      {p.backup.problem
                        ? `⚠ ${p.backup.problem}`
                        : "OneDrive等の同期フォルダを選ぶと、変更のたびに自動で控えを取ります"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="truncate px-3 text-xs text-gray-700" title={p.backup.dirName}>
                      バックアップ先: <span className="font-semibold">{p.backup.dirName}</span>
                      <span className="text-emerald-600">(接続中)</span>
                    </p>
                    <p
                      className={`px-3 pb-1 text-xs ${
                        p.backup.problem ? "text-amber-700" : "text-gray-500"
                      }`}
                    >
                      {p.backup.problem
                        ? `⚠ ${p.backup.problem}`
                        : p.backup.lastSuccessAt
                          ? `最終バックアップ: ${p.backup.lastSuccessAt} 成功`
                          : "まだバックアップしていません"}
                    </p>
                    <button
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        p.onBackupNow();
                        setDataMenuOpen(false);
                      }}
                      title="保留中のときも、これで控えを最新の内容に上書きできます"
                    >
                      ⤓ 今すぐバックアップ
                    </button>
                    <button
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        p.onReconnectBackupDir();
                        setDataMenuOpen(false);
                      }}
                    >
                      🔄 再接続
                    </button>
                    <button
                      className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        p.onDisconnectBackupDir();
                        setDataMenuOpen(false);
                      }}
                    >
                      ✕ 接続を解除
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onImportFile(f);
              e.target.value = ""; // 同じファイルを再選択できるように
              setDataMenuOpen(false);
            }}
          />
        </div>
      </div>

      {/* 2段目: 仕事/個人モード・表示切替・絞込 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* 仕事/個人モード切替(Mキーでも巡回)。タスク自身の仕事/個人でビューを絞る */}
        <div className="flex items-center gap-1">
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
        </div>

        <span className="mx-1 text-gray-300">|</span>

        {/* ビュー選択: 単独[今日以降][予定] + ドロップダウン[今日/完了/全期間] */}
        <div className="flex items-center gap-1">
          <button
            className={chip(p.viewMode === "todayOnward")}
            onClick={() => p.onViewModeChange("todayOnward")}
            title="今日以降のタスク＋繰越(普段使い)"
          >
            今日以降
          </button>
          <button
            className={chip(p.viewMode === "planned")}
            onClick={() => p.onViewModeChange("planned")}
            title="今日以降で時刻が決まっている予定＋繰越"
          >
            予定
          </button>
          <div className="relative">
            <button
              className={chip(dropdownActive)}
              onClick={() => setViewMenuOpen((o) => !o)}
              title="今日 / 完了 / 全期間"
            >
              {dropdownActive ? VIEW_MODE_LABELS[p.viewMode] : "その他"} ▾
            </button>
            {viewMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setViewMenuOpen(false)} />
                <div className="absolute left-0 top-9 z-50 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                  {DROPDOWN_VIEWS.map((v) => (
                    <button
                      key={v}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                        p.viewMode === v ? "font-semibold text-blue-600" : "text-gray-700"
                      }`}
                      onClick={() => {
                        p.onViewModeChange(v);
                        setViewMenuOpen(false);
                      }}
                    >
                      {VIEW_MODE_LABELS[v]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <span className="mx-1 text-gray-300">|</span>

        <div className="flex gap-1">
          {(["table", "tableLight", "cards"] as LayoutMode[]).map((l) => (
            <button
              key={l}
              className={chip(p.layout === l)}
              onClick={() => p.onLayoutChange(l)}
              title={l === "tableLight" ? "高密度の表(Excel風の詰め込み表示)" : undefined}
            >
              {LAYOUT_LABELS[l]}
            </button>
          ))}
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

        {/* 完了も表示: 完了/全期間ビューでは意味がないので隠す */}
        {p.viewMode !== "done" && p.viewMode !== "everything" && (
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={p.showDone}
              onChange={(e) => p.onShowDoneChange(e.target.checked)}
            />
            完了も表示
          </label>
        )}

        <span className="mx-1 text-gray-300">|</span>

        {/* 選択操作(一括編集・連続時刻の対象) */}
        <button
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
          onClick={p.onSelectAllVisible}
          title="表示中のタスクをすべて選択"
        >
          全選択
        </button>
        {p.selectedCount > 0 && (
          <button
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
            onClick={p.onClearSelection}
            title="選択を解除"
          >
            選択解除 ({p.selectedCount})
          </button>
        )}
      </div>
    </div>
  );
}
