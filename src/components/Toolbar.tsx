// ==============================================================
// ツールバー: 日付移動・仕事/個人モード・表示切替・カテゴリ絞込・各種操作
// ==============================================================
import { useEffect, useRef, useState } from "react";
import type { DoneFilter, ViewMode, WorkMode } from "../types";
import { DONE_FILTER_LABELS, VIEW_MODE_LABELS, WORK_MODE_LABELS } from "../types";
import { formatDateJa, formatMin, todayStr } from "../lib/date";
import type { BackupState } from "../lib/backup";
import { ownerLabel, type BatonState } from "../lib/baton";
import { loadGcalConfig, saveGcalConfig } from "../lib/gcalClient";
import { loadGdriveConfig, saveGdriveConfig } from "../lib/backupTargets/gdrive";
import type { BackupTargetId } from "../lib/backupTargets/types";
import { backupNeedsAttention } from "../lib/backup";

/** ドロップダウン(その他)にまとめる期間 */
const DROPDOWN_VIEWS: ViewMode[] = ["today", "everything", "custom"];

/**
 * 開いているメニューを「外側クリック」と Esc で閉じる。返り値の ref を
 * 「開くボタン＋メニュー本体」を囲む要素に付ける。
 *
 * 背景に fixed のオーバーレイを敷く手は使えない。ツールバーが backdrop-blur を
 * 持つため、その要素が position:fixed の基準になり、オーバーレイが画面全体ではなく
 * ツールバーの高さ(1280x86)しか覆わない。一覧の上をクリックしても閉じなかった原因。
 */
function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // ボタン自身の上での pointerdown は無視する(閉じてから click で開き直ると点滅するため)
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // App 側の Esc(ダイアログを閉じる等)まで巻き込まない
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

/** タイムスタンプ(ms)を HH:MM にする(スヌーズ期限の表示用) */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** タスク名フィルタの履歴(localStorage) */
const HISTORY_KEY = "worklist3.titleFilterHistory";
const HISTORY_MAX = 10;

export function loadFilterHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** 同じ語は先頭へ寄せ、直近 HISTORY_MAX 件だけ残す */
function pushFilterHistory(q: string): string[] {
  const next = [q, ...loadFilterHistory().filter((s) => s !== q)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても絞り込み自体は動く */
  }
  return next;
}

interface Props {
  selectedDate: string;
  onDateChange: (date: string) => void;
  mode: WorkMode;
  onModeChange: (m: WorkMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  /** カスタム(範囲指定)の開始日・終了日。空=その側は無制限 */
  customFrom: string;
  customTo: string;
  onCustomFromChange: (d: string) => void;
  onCustomToChange: (d: string) => void;
  categories: string[];
  categoryFilter: string;
  onCategoryFilterChange: (c: string) => void;
  doneFilter: DoneFilter;
  onDoneFilterChange: (d: DoneFilter) => void;
  plannedOnly: boolean;
  onPlannedOnlyChange: (v: boolean) => void;
  titleFilter: string;
  onTitleFilterChange: (q: string) => void;
  onAdd: () => void;
  onClipboardImport: () => void;
  onBulkAdd: () => void;
  onRandomStart: () => void;
  onSequentialStart: () => void;
  onBulkEdit: () => void;
  /** 選択タスクをGoogleカレンダーへ登録/更新 */
  onSyncCalendar: () => void;
  /** カレンダー登録の実行中(連打・二重登録の防止でボタンを無効化する。Issue #29) */
  syncingCalendar: boolean;
  /** カレンダー連携をリセット(トークン破棄) */
  onResetCalendarAuth: () => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  selectedCount: number;
  onExport: () => void;
  /** エクスポートを gzip で保存するか */
  exportGzip: boolean;
  /** この環境で gzip が使えるか(使えなければ選択肢を出さない) */
  gzipSupported: boolean;
  onToggleExportGzip: () => void;
  /** 一覧に出ているタスクをCSVにしてクリップボードへ */
  onCopyCsv: () => void;
  /** 一覧に出ている件数(CSVコピーが何件対象かを示す) */
  visibleCount: number;
  /** JSONファイルからの一括インポート(Issue #12) */
  onImportFile: (file: File) => void;
  /** 同期フォルダへの自動バックアップの状態 */
  backup: BackupState;
  /** 端末の手番(#91)。グループ名の補足文と、更新側の表示に使う */
  baton: BatonState;
  /** 接続中のフォルダID(2台が同じデータを見ているかの確認用) */
  folderId: string;
  onToggleBaton: (on: boolean) => void;
  /** 端末名の変更。手番ファイルの表示名も直す必要がある(#91 §4.2) */
  onDeviceNameChange: (name: string) => void;
  /** 選べる保存先(排他。同時に両方へは書かない) */
  backupTargetOptions: { id: BackupTargetId; label: string; supported: boolean }[];
  onSwitchBackupTarget: (id: BackupTargetId) => void;
  /** 保管形式(gzipで圧縮するか) */
  onSetBackupCompress: (on: boolean) => void;
  /** Drive 上の控えを一覧して復元する */
  onRestoreFromDrive: () => void;
  /** Drive の内容を見るだけ(手元は変えない。#109 §4.2) */
  onViewDrive: () => void;
  /** 「ここにいる」記録を開く(Issue #86)。モバイルでのみ出す */
  onRecordLocation: () => void;
  /** この環境で位置情報が使えるか(使えなければボタンを出さない) */
  geoSupported: boolean;
  onChooseBackupDir: () => void;
  onReconnectBackupDir: () => void;
  onDisconnectBackupDir: () => void;
  onBackupNow: () => void;
  /** ◯分だけバックアップ警告を止める(Issue #20) */
  onSnoozeBackup: (minutes: number) => void;
  onClearBackupSnooze: () => void;
  totals: { estimate: number; actual: number; remain: number };
  /** ショートカット一覧(=最終更新日)を開く。スマホは?キーが無いのでボタンで開けるように(Issue #41) */
  onOpenHelp: () => void;
  /** 読み取り専用(別窓が書き手のとき)。作成・変更系ボタンを無効化する。#57 */
  readOnly?: boolean;
  /**
   * モバイル表示(狭い画面)。絞り込み類を既定で畳み、
   * 選択操作やPC前提の機能(取込・一括登録など)を出さない。
   * 広い画面では従来どおり全部出す。
   */
  compact?: boolean;
}

const chip = (active: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
    active ? "bg-blue-600 text-white" : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
  }`;

// ツールバーの操作ボタン(#43): アイコンのみ・正方形固定幅で横幅を一定に保ち、
// 件数が変わってもレイアウトがずれないようにする。文字はツールチップで補う。
const iconBtn =
  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-base leading-none transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white";
const addBtn =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded border border-blue-600 bg-blue-600 text-lg font-bold leading-none text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-300";
// 選択件数バッジ(ボタン右上に重ねる)。ボタン幅を変えないので並びがずれない。
const badgeCls =
  "absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white";
const toolDivider = "mx-1 h-6 w-px shrink-0 self-center bg-gray-200";

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
  /** モバイルで絞り込み類を開いているか。毎回閉じた状態から始める */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(loadFilterHistory);
  const [gcalClientId, setGcalClientId] = useState(() => loadGcalConfig().clientId);
  const [gcalCalendarId, setGcalCalendarId] = useState(() => loadGcalConfig().calendarId);
  const [driveClientId, setDriveClientId] = useState(() => loadGdriveConfig().clientId);
  const [driveGroup, setDriveGroup] = useState(() => loadGdriveConfig().group);
  const [driveDeviceName, setDriveDeviceName] = useState(() => loadGdriveConfig().deviceName);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropdownActive = DROPDOWN_VIEWS.includes(p.viewMode);
  const viewMenuRef = useDismiss(viewMenuOpen, () => setViewMenuOpen(false));
  const dataMenuRef = useDismiss(dataMenuOpen, () => setDataMenuOpen(false));

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
        <h1 className="text-lg font-bold text-gray-800">worklist3</h1>
        <button
          type="button"
          onClick={p.onOpenHelp}
          title="ショートカット一覧・最終更新日(?キーでも開く)"
          aria-label="ショートカット一覧・最終更新日"
          className="mr-1 flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-xs font-bold text-gray-500 hover:bg-gray-100"
        >
          ?
        </button>

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

        {/* カスタム(範囲指定): 片側を空にすると「この日以降」「この日まで」になる */}
        {p.viewMode === "custom" && (
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={p.customFrom}
              onChange={(e) => p.onCustomFromChange(e.target.value)}
              title="開始日(空ならこの日以前も全部)"
            />
            <span className="text-sm text-gray-500">〜</span>
            <input
              type="date"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              value={p.customTo}
              onChange={(e) => p.onCustomToChange(e.target.value)}
              title="終了日(空ならこの日以降も全部)"
            />
            {(p.customFrom || p.customTo) && (
              <button
                className={chip(false)}
                onClick={() => {
                  p.onCustomFromChange("");
                  p.onCustomToChange("");
                }}
                title="範囲を空にする(全期間と同じになる)"
              >
                クリア
              </button>
            )}
            <span className="ml-1 text-xs text-gray-500">
              {!p.customFrom && !p.customTo
                ? "日付のあるタスク全て"
                : !p.customTo
                  ? `${formatDateJa(p.customFrom)} 以降`
                  : !p.customFrom
                    ? `${formatDateJa(p.customTo)} まで`
                    : `${formatDateJa(p.customFrom)} 〜 ${formatDateJa(p.customTo)}`}
            </span>
          </div>
        )}

        {/* 合計はモバイルでは1段目に入らないので、絞り込みの折りたたみの中へ移す */}
        {!p.compact && (
          <span className="ml-2 text-xs text-gray-500">
            見積 {formatMin(p.totals.estimate) || "0m"} / 実績 {formatMin(p.totals.actual) || "0m"} /
            残り {formatMin(p.totals.remain) || "0m"}
          </span>
        )}

        <div className="relative ml-auto flex flex-wrap items-center gap-2">
          {/* 作成系(読み取り専用の窓では無効化。#57) */}
          <button
            className={addBtn}
            disabled={p.readOnly}
            onClick={p.onAdd}
            title="タスク追加(Nキー)"
            aria-label="タスク追加"
          >
            ＋
          </button>

          {/* 「ここにいる」記録(Issue #86)。出先で片手で押す機能なのでモバイルだけに出す。
              位置情報が使えない環境では出さない */}
          {p.compact && p.geoSupported && (
            <button
              className={`${iconBtn} text-gray-700`}
              disabled={p.readOnly}
              onClick={p.onRecordLocation}
              title="いまいる場所を記録する"
              aria-label="ここにいる記録"
            >
              📍
            </button>
          )}
          {/* ここから先は選択操作やPC上のアプリ(Teams/Outlook)を前提にした機能。
              モバイルでは使えないか使わないので出さない */}
          {!p.compact && (
          <>
          <button
            className={`${iconBtn} text-gray-700`}
            disabled={p.readOnly}
            onClick={p.onClipboardImport}
            title="クリップボードからTeams/予定/テキストを自動判別して取込(Vキー)"
            aria-label="クリップボードから取込"
          >
            📋
          </button>
          <button
            className={`${iconBtn} text-gray-700`}
            disabled={p.readOnly}
            onClick={p.onBulkAdd}
            title="テキストを貼り付けて複数タスクを一括登録"
            aria-label="一括登録"
          >
            📥
          </button>
          <button
            className={`${iconBtn} text-gray-700`}
            disabled={p.readOnly}
            onClick={p.onRandomStart}
            title="今日のタスクからランダムに1件開始"
            aria-label="ランダムに1件開始"
          >
            🎲
          </button>

          <span className={toolDivider} aria-hidden />

          {/* 選択が必要な操作(#43): 未選択時は無効(グレーアウト)にして常時表示。件数は右上バッジ */}
          <button
            className={`${iconBtn} text-gray-700`}
            disabled={p.readOnly || p.selectedCount === 0}
            onClick={p.onSequentialStart}
            title="選択したタスクに、見積を積み上げて連続の開始予定時刻を設定"
            aria-label="連続開始時刻を設定"
          >
            ⏱
            {p.selectedCount > 0 && <span className={badgeCls}>{p.selectedCount}</span>}
          </button>
          <button
            className={`${iconBtn} text-gray-700`}
            disabled={p.readOnly || p.selectedCount === 0}
            onClick={p.onBulkEdit}
            title="選択したタスクの項目(日付・期限・カテゴリ・重要度・区分)をまとめて変更"
            aria-label="一括編集"
          >
            ✏️
            {p.selectedCount > 0 && <span className={badgeCls}>{p.selectedCount}</span>}
          </button>
          <button
            className={`${iconBtn} text-gray-700`}
            // 登録中は無効化して連打による二重登録を防ぐ(Issue #29)
            disabled={p.readOnly || p.selectedCount === 0 || p.syncingCalendar}
            onClick={p.onSyncCalendar}
            title="選択した予定(開始時刻あり)をGoogleカレンダーへ登録/更新。時刻なしはスキップ"
            aria-label={p.syncingCalendar ? "カレンダー登録中" : "カレンダー登録"}
          >
            {p.syncingCalendar ? "⏳" : "📅"}
            {p.selectedCount > 0 && <span className={badgeCls}>{p.selectedCount}</span>}
          </button>
          <button
            className={`${iconBtn} text-red-600`}
            disabled={p.readOnly || p.selectedCount === 0}
            onClick={p.onDeleteSelected}
            title="選択したタスクをまとめて削除"
            aria-label="選択を削除"
          >
            🗑
            {p.selectedCount > 0 && <span className={`${badgeCls} bg-red-600`}>{p.selectedCount}</span>}
          </button>

          <span className={toolDivider} aria-hidden />
          </>
          )}

          {/* バックアップ異常の警告(Issue #20)。異常時だけ出す。押すと💾メニューへ。
              スヌーズ中は控えめな「停止中」表示にする */}
          {backupNeedsAttention(p.backup) &&
            (Date.now() < p.backup.snoozedUntil ? (
              <button
                className={`${iconBtn} text-gray-500`}
                onClick={() => setDataMenuOpen(true)}
                title={`バックアップ警告を停止中(${fmtClock(p.backup.snoozedUntil)}まで)。押すと詳細`}
                aria-label="バックアップ警告(停止中)"
              >
                💤
              </button>
            ) : (
              <button
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded border border-amber-400 bg-amber-50 text-base leading-none text-amber-800 transition-colors hover:bg-amber-100"
                onClick={() => setDataMenuOpen(true)}
                title="自動バックアップが動いていません。押すと詳細と対処"
                aria-label="バックアップ未実行"
              >
                ⚠
              </button>
            ))}
          <div className="relative" ref={dataMenuRef}>
          <button
            className={`${iconBtn} text-gray-700`}
            onClick={() => setDataMenuOpen((o) => !o)}
            title="データのエクスポート/インポート"
            aria-label="データメニュー"
          >
            💾
          </button>
          {/* データメニュー(エクスポート/インポート/自動バックアップ)。Issue #12
              外側クリック・Esc で閉じる(useDismiss)。fixed の背景は使えない事情はそちらのコメント参照 */}
          {dataMenuOpen && (
            <>
              {/* 画面より高くなったら中でスクロールさせる。max-height と overflow-y が
                  無いと、はみ出した下側(接続・今すぐバックアップ・接続を解除)へ
                  永久に到達できない。項目が増えると必ず起きるので、高さは
                  ビューポートに縛っておく */}
              <div className="absolute right-0 top-10 z-50 max-h-[calc(100dvh-4rem)] w-72 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    p.onExport();
                    setDataMenuOpen(false);
                  }}
                >
                  ⬇ エクスポート({p.exportGzip ? "圧縮して保存 .gz" : "JSONを保存"})
                </button>
                {/* 保管形式の選択。圧縮すると約20分の1になるが、そのままでは中身を読めない。
                    圧縮したものもインポートは中身を見て自動で展開する */}
                {p.gzipSupported && (
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1 pl-6 text-xs text-gray-500 hover:bg-gray-100">
                    <input
                      type="checkbox"
                      checked={p.exportGzip}
                      onChange={p.onToggleExportGzip}
                    />
                    gzipで圧縮する(.gz)
                  </label>
                )}
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => fileRef.current?.click()}
                >
                  ⬆ インポート(JSON / .gz を読込)
                </button>

                <div className="my-1 border-t border-gray-200" />

                {/* 表示中のものをCSVでコピー(生成AIに渡して日記にする用途)。
                    対象は今の絞り込みの結果なので、専用のフィルタは持たない */}
                <button
                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    p.onCopyCsv();
                    setDataMenuOpen(false);
                  }}
                  title="今の絞り込みで表示しているタスクをCSVにしてクリップボードへ"
                >
                  📋 表示中をCSVでコピー ({p.visibleCount}件)
                </button>
                <p className="px-3 pb-2 text-xs text-gray-500">
                  完了だけ欲しいときは 完了:「完了のみ」、期間は「カスタム」で指定できます
                </p>

                <div className="my-1 border-t border-gray-200" />
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-gray-400">
                  Google カレンダー連携
                </div>
                <div className="px-3 pb-2">
                  <label className="mb-0.5 block text-[11px] text-gray-500">Client ID</label>
                  <input
                    type="text"
                    className="mb-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    placeholder="xxxxx.apps.googleusercontent.com"
                    value={gcalClientId}
                    onChange={(e) => {
                      setGcalClientId(e.target.value);
                      saveGcalConfig({ clientId: e.target.value });
                    }}
                  />
                  <label className="mb-0.5 block text-[11px] text-gray-500">Calendar ID</label>
                  <input
                    type="text"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                    placeholder="xxxxx@group.calendar.google.com"
                    value={gcalCalendarId}
                    onChange={(e) => {
                      setGcalCalendarId(e.target.value);
                      saveGcalConfig({ calendarId: e.target.value });
                    }}
                  />
                  <button
                    className="mt-1.5 text-xs text-gray-500 underline hover:text-gray-700"
                    onClick={() => p.onResetCalendarAuth()}
                    title="メモリ上のアクセストークンを破棄する(次回は再取得。設定値は消えない)"
                  >
                    連携をリセット(サインアウト)
                  </button>
                  <p className="mt-1 text-[11px] text-gray-400">
                    予定を選んで「📅 カレンダー登録」で専用カレンダーへ同期します
                  </p>
                </div>

                <div className="my-1 border-t border-gray-200" />
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-gray-400">
                  自動バックアップ
                </div>

                {/* Issue #20: 異常時の警告スヌーズ。押すと15/30/60分だけ黙る */}
                {backupNeedsAttention(p.backup) &&
                  (Date.now() < p.backup.snoozedUntil ? (
                    <div className="mx-3 mb-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
                      💤 警告を停止中({fmtClock(p.backup.snoozedUntil)}まで)
                      <button
                        className="ml-2 text-blue-600 underline hover:text-blue-800"
                        onClick={() => p.onClearBackupSnooze()}
                      >
                        今すぐ戻す
                      </button>
                    </div>
                  ) : (
                    <div className="mx-3 mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      <span className="font-semibold">⚠ 自動バックアップが動いていません。</span>
                      <div className="mt-1 flex items-center gap-1 text-gray-600">
                        <span>しばらく黙らせる:</span>
                        {[15, 30, 60].map((min) => (
                          <button
                            key={min}
                            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 hover:bg-gray-100"
                            onClick={() => p.onSnoozeBackup(min)}
                          >
                            {min}分
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                {/* 保存先の選択(排他)。切替前の保存先のファイルは消さないので、
                    新しい保存先に世代が貯まるまでの保険として残しておける */}
                <div className="flex items-center gap-1 px-3 py-1 text-xs">
                  <span className="text-gray-500">保存先:</span>
                  {/* 使えない保存先も選べるようにしておく。選べないと、その保存先が
                      なぜ使えないのかを説明する画面に辿り着けず、いま選んでいる方から
                      戻れなくなる(閉じ込め) */}
                  {p.backupTargetOptions.map((t) => (
                    <button
                      key={t.id}
                      className={
                        t.id === p.backup.targetId
                          ? "rounded border border-blue-500 bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700"
                          : t.supported
                            ? "rounded border border-gray-300 bg-white px-1.5 py-0.5 hover:bg-gray-100"
                            : "rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-400 hover:bg-gray-100"
                      }
                      title={t.supported ? "" : "この環境では使えません(選ぶと理由が出ます)"}
                      onClick={() => p.onSwitchBackupTarget(t.id)}
                    >
                      {t.label}
                      {!t.supported && "(不可)"}
                    </button>
                  ))}
                </div>

                {/* 接続の有無で隠さない(#91)。接続中に Client ID・グループ名・端末名・
                    フォルダID を確認できないと、2台目の設定が1台目と揃っているか
                    確かめられない。#84 の「必要な設定に辿り着けない」の再来を避ける */}
                {p.backup.targetId === "gdrive" && (
                  <div className="px-3 pb-2">
                    <label className="mb-0.5 block text-[11px] text-gray-500">Client ID</label>
                    <input
                      type="text"
                      className="mb-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="xxxxx.apps.googleusercontent.com"
                      value={driveClientId}
                      onChange={(e) => {
                        setDriveClientId(e.target.value);
                        saveGdriveConfig({ clientId: e.target.value });
                      }}
                    />
                    <label className="mb-0.5 block text-[11px] text-gray-500">
                      グループ名(同じ名前の端末どうしで、同じデータを共有します)
                    </label>
                    <input
                      type="text"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="わたしのタスク など"
                      value={driveGroup}
                      onChange={(e) => {
                        setDriveGroup(e.target.value);
                        saveGdriveConfig({ group: e.target.value });
                      }}
                    />
                    {/* 同じ値にしてよいかは手番制の有無で真逆になる(#91 §6) */}
                    <p className="mt-1 text-[11px] text-gray-500">
                      {p.baton.enabled
                        ? "共有したい端末には同じ名前を付けてください"
                        : "端末ごとに違う名前を付けてください（同じだと上書きし合います）"}
                    </p>

                    <label className="mb-0.5 mt-2 block text-[11px] text-gray-500">
                      端末名(他の端末の画面に出ます。任意)
                    </label>
                    <input
                      type="text"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                      placeholder="スマホ / 自宅PC など"
                      value={driveDeviceName}
                      onChange={(e) => {
                        setDriveDeviceName(e.target.value);
                        saveGdriveConfig({ deviceName: e.target.value });
                        p.onDeviceNameChange(e.target.value);
                      }}
                    />

                    {/* 2台が同じデータを見ているかは、これが一致するかで確かめられる(#91 §4.0a) */}
                    {p.backup.connected && p.folderId && (
                      <p className="mt-2 break-all text-[11px] text-gray-500">
                        フォルダID: <code className="text-gray-600">{p.folderId}</code>
                        <br />
                        2台で一致していることを確認してください
                      </p>
                    )}

                    {/* 手番制(#91)。既定OFF。1台運用に余計な仕組みを背負わせない。
                        未接続でも項目自体は出す — 隠すと機能の存在に気づけない */}
                    <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
                      <label
                        className={`flex items-center gap-1.5 text-[11px] ${
                          p.backup.connected ? "text-gray-700" : "text-gray-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!p.backup.connected}
                          checked={p.baton.enabled}
                          onChange={(e) => p.onToggleBaton(e.target.checked)}
                        />
                        複数台で使う(更新する端末を1台に決める)
                      </label>
                      {!p.backup.connected ? (
                        <p className="mt-1 text-[11px] text-gray-500">
                          Google ドライブへ接続すると設定できます
                        </p>
                      ) : (
                        p.baton.enabled && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            いまの更新側:{" "}
                            {p.baton.role === "owner"
                              ? "この端末"
                              : p.baton.role === "guest"
                                ? ownerLabel(p.baton.ownerName)
                                : "未設定"}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )}

                {!p.backup.supported ? (
                  <p className="px-3 pb-2 text-xs text-amber-700">
                    ⚠ この保存先はこの環境では使えないため、自動バックアップは動きません。
                    {p.backup.targetId === "fsa"
                      ? "ローカルフォルダは File System Access API を使いますが、このブラウザでは無効です" +
                        "(Chrome / Edge なら使えます。Brave は既定で無効で、brave://flags の" +
                        " File System Access API から有効にできます)。" +
                        "このブラウザのまま控えを取るなら「Google ドライブ」を選んでください。"
                      : "別の保存先を選んでください。"}
                  </p>
                ) : !p.backup.connected ? (
                  <>
                    {/* 権限切れ: 保存済みの接続情報があるので、選び直さず再接続だけで戻せる */}
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
                      {p.backup.targetId === "gdrive"
                        ? "🔗 Google ドライブへ接続"
                        : `📁 バックアップ先フォルダを${p.backup.needsReconnect ? "選び直す" : "選択"}`}
                    </button>
                    <p
                      className={`px-3 pb-2 text-xs ${
                        p.backup.problem ? "text-amber-700" : "text-gray-500"
                      }`}
                    >
                      {p.backup.problem
                        ? `⚠ ${p.backup.problem}`
                        : p.backup.targetId === "gdrive"
                          ? "マイドライブに worklist3 フォルダを作り、変更のたびに自動で控えを取ります"
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
                        : p.backup.offline
                          ? "オフライン(未送信)。回線が戻ったら自動で書き込みます"
                          : p.backup.lastSuccessAt
                            ? `最終バックアップ: ${p.backup.lastSuccessAt} 成功`
                            : "まだバックアップしていません"}
                    </p>
                    {/* 保管形式。圧縮すると約20分の1になるが、そのままでは中身を読めない。
                        圧縮した控えもインポートは中身を見て自動で展開する */}
                    {p.backup.compressSupported && (
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs text-gray-500 hover:bg-gray-100">
                        <input
                          type="checkbox"
                          checked={p.backup.compress}
                          onChange={(e) => p.onSetBackupCompress(e.target.checked)}
                        />
                        gzipで圧縮して保管(通信量を約1/20に)
                      </label>
                    )}
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
                    {p.backup.targetId === "gdrive" && (
                      <button
                        className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          p.onRestoreFromDrive();
                          setDataMenuOpen(false);
                        }}
                        title="Drive 上の控え(ミラーと日次14世代)から選んで読み込みます"
                      >
                        ♻ Drive の控えから復元
                      </button>
                    )}
                    {/* 見るだけ(#109 §4.2)。復元と違い、この端末のデータには触れない。
                        手番の有無に関わらず使える */}
                    {p.backup.targetId === "gdrive" && (
                      <button
                        className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          p.onViewDrive();
                          setDataMenuOpen(false);
                        }}
                        title="Drive の内容を表示します。この端末のデータは変わりません"
                      >
                        👁 Drive の内容を見る(手元は変えません)
                      </button>
                    )}
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
            accept=".json,.gz,application/json,application/gzip"
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

        {/* モバイルは絞り込み類を畳む。ここが開かないと画面の半分が操作欄で埋まる */}
        {p.compact && (
          <button
            className={chip(filtersOpen)}
            onClick={() => setFiltersOpen((v) => !v)}
            title="絞り込みの表示/非表示"
            aria-expanded={filtersOpen}
          >
            🔍 絞り込み
          </button>
        )}

        {(!p.compact || filtersOpen) && (
          <>
        <span className="mx-1 text-gray-300">|</span>

        {/* 期間: 単独[今日以降] + ドロップダウン[今日/全期間/カスタム] */}
        <div className="flex items-center gap-1">
          <button
            className={chip(p.viewMode === "todayOnward")}
            onClick={() => p.onViewModeChange("todayOnward")}
            title="今日以降のタスク＋繰越(普段使い)"
          >
            今日以降
          </button>
          <div className="relative" ref={viewMenuRef}>
            <button
              className={chip(dropdownActive)}
              onClick={() => setViewMenuOpen((o) => !o)}
              title="今日 / 全期間 / カスタム(範囲指定)"
            >
              {dropdownActive ? VIEW_MODE_LABELS[p.viewMode] : "その他"} ▾
            </button>
            {viewMenuOpen && (
              <>
                <div className="absolute left-0 top-9 z-50 max-h-[calc(100dvh-4rem)] w-32 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
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

        {/* 表示形式の切替(表形式/表ライト/カード形式)は一覧から外した。types.ts 参照。
            戻すときはこのブロックと App の T キーのコメントを外す
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
        */}

        <span className="mx-1 text-gray-300">|</span>

        {/* 予定のみ: 開始予定時刻が入ったものだけ(打合せなど時間が決まった予定の確認) */}
        <button
          role="switch"
          aria-checked={p.plannedOnly}
          className="flex items-center gap-1.5 text-xs text-gray-600"
          onClick={() => p.onPlannedOnlyChange(!p.plannedOnly)}
          title="開始予定時刻が入っているタスクだけに絞る"
        >
          <span
            className={`relative h-4 w-7 rounded-full transition-colors ${
              p.plannedOnly ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                p.plannedOnly ? "left-3.5" : "left-0.5"
              }`}
            />
          </span>
          <span className={p.plannedOnly ? "font-semibold text-blue-700" : undefined}>予定のみ</span>
        </button>

        <span className="mx-1 text-gray-300">|</span>

        {/* 完了の扱い(すべて/完了のみ/完了を隠す)。
            モード側にも「すべて」があるので、見出しを付けて取り違えを防ぐ */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">完了:</span>
          {(["all", "onlyDone", "hideDone"] as DoneFilter[]).map((d) => (
            <button
              key={d}
              className={chip(p.doneFilter === d)}
              onClick={() => p.onDoneFilterChange(d)}
              title={
                d === "all"
                  ? "完了も未完了も表示"
                  : d === "onlyDone"
                    ? "完了したものだけ(振り返り用)"
                    : "完了を隠して残りの作業に集中"
              }
            >
              {DONE_FILTER_LABELS[d]}
            </button>
          ))}
        </div>

        <span className="mx-1 text-gray-300">|</span>

        {/* 選択操作(一括編集・連続時刻の対象)。モバイルでは使わないので出さない */}
        {!p.compact && (
          <>
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
          </>
        )}

        <span className="mx-1 text-gray-300">|</span>

        {/* タスク名フィルタ: 中間一致。/パターン/ で正規表現。Enterで履歴に残る */}
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-2 text-xs text-gray-400">🔍</span>
          <input
            type="search"
            list="worklist3-filter-history"
            className="w-52 rounded border border-gray-300 py-1 pl-6 pr-2 text-xs"
            placeholder="タスク名で絞り込み"
            value={p.titleFilter}
            onChange={(e) => p.onTitleFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && p.titleFilter.trim()) setHistory(pushFilterHistory(p.titleFilter.trim()));
              if (e.key === "Escape") p.onTitleFilterChange("");
            }}
            title={"中間一致(大文字小文字は区別しない)\n/パターン/ で正規表現(例 /^報告/)\nEnterで履歴に残る・Escで消去"}
          />
          <datalist id="worklist3-filter-history">
            {history.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </div>

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

        {/* 1段目に入らない合計は、モバイルではここへ */}
        {p.compact && (
          <span className="w-full text-xs text-gray-500">
            見積 {formatMin(p.totals.estimate) || "0m"} / 実績 {formatMin(p.totals.actual) || "0m"} /
            残り {formatMin(p.totals.remain) || "0m"}
          </span>
        )}
          </>
        )}
      </div>
    </div>
  );
}
