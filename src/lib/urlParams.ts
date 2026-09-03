// ==============================================================
// URLクエリで表示状態を指定して開く/共有する(Issue #4)
//   ?mode=work|personal|all
//   &view=todayOnward|today|everything|custom   (期間)
//   &from=YYYY-MM-DD &to=YYYY-MM-DD             (view=custom の範囲。片側省略可)
//   &done=all|onlyDone|hideDone                 (完了の扱い)
//   &planned=1|0                                (予定のみ=開始予定時刻ありに絞る)
//   &category=...                               (カテゴリ絞り込み)
//   &q=...                                      (タスク名フィルタ。/パターン/ で正規表現)
//   &ui=mobile|desktop|auto                     (表示の強制。既定は画面幅で自動)
//   &action=here                                (開いた直後に「ここにいる」記録を開く。#105)
//
//   action は「表示状態」ではなく1回きりの操作なので、writeUrlSettings() が
//   起動直後にクエリを組み直す際、書き戻されずに URL から消える。これは意図した
//   挙動で、リロードで記録ダイアログが何度も開くのを防いでいる
//   (ブックマーク側には残るので、次にタップすればまた開く)。
// ==============================================================
import type { DoneFilter, ViewMode, WorkMode } from "../types";
import type { UiOverride } from "./useIsMobile";

const VIEWS: ViewMode[] = ["todayOnward", "today", "everything", "custom"];
const DONE_FILTERS: DoneFilter[] = ["all", "onlyDone", "hideDone"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface UrlSettings {
  mode?: WorkMode;
  view?: ViewMode;
  from?: string;
  to?: string;
  done?: DoneFilter;
  planned?: boolean;
  category?: string;
  q?: string;
  /** 表示の強制(mobile/desktop)。未指定は画面幅で自動 */
  ui?: UiOverride;
}

/**
 * 起動時に1回だけ行う操作(#105)。
 * スマートフォンのブックマークから「さっと起動、さっと記録」するための入口。
 */
export type StartupAction = "here" | undefined;

/** クエリ文字列から起動時の操作を読む。純粋関数なのでテスト対象 */
export function parseStartupAction(search: string): StartupAction {
  return new URLSearchParams(search).get("action") === "here" ? "here" : undefined;
}

/** 現在のURLから起動時の操作を読む */
export function readStartupAction(): StartupAction {
  return parseStartupAction(typeof window !== "undefined" ? window.location.search : "");
}

/** 現在のURLから設定を読む(不正な値は無視) */
export function readUrlSettings(): UrlSettings {
  const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const s: UrlSettings = {};

  const mode = p.get("mode");
  if (mode === "work" || mode === "personal" || mode === "all") s.mode = mode;

  const view = p.get("view");
  if (view && VIEWS.includes(view as ViewMode)) s.view = view as ViewMode;

  const from = p.get("from");
  if (from && DATE_RE.test(from)) s.from = from;
  const to = p.get("to");
  if (to && DATE_RE.test(to)) s.to = to;

  const done = p.get("done");
  if (done && DONE_FILTERS.includes(done as DoneFilter)) s.done = done as DoneFilter;
  // 旧形式(done=1|0 で「完了も表示」)からの移行
  else if (done === "1" || done === "true") s.done = "all";
  else if (done === "0" || done === "false") s.done = "hideDone";

  const planned = p.get("planned");
  if (planned === "1" || planned === "true") s.planned = true;
  else if (planned === "0" || planned === "false") s.planned = false;

  const category = p.get("category");
  if (category) s.category = category;

  const q = p.get("q");
  if (q) s.q = q;

  // ui=auto と不正な値は「自動」= undefined のまま
  const ui = p.get("ui");
  if (ui === "mobile" || ui === "desktop") s.ui = ui;

  return s;
}

/** 現在の表示状態をURLへ反映(履歴は汚さず置換)。既定値は書かずURLを短く保つ */
export function writeUrlSettings(s: {
  mode: WorkMode;
  view: ViewMode;
  done: DoneFilter;
  planned: boolean;
  category: string;
  q: string;
  from: string;
  to: string;
  /** 強制指定。自動(undefined)のときはURLへ書かない */
  ui: UiOverride;
}) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  p.set("mode", s.mode);
  p.set("view", s.view);
  if (s.view === "custom") {
    if (s.from) p.set("from", s.from);
    if (s.to) p.set("to", s.to);
  }
  p.set("done", s.done);
  if (s.planned) p.set("planned", "1");
  if (s.category) p.set("category", s.category);
  if (s.q) p.set("q", s.q);
  // 自動のときは書かない。書いてしまうと、スマートフォンで開いたURLをそのまま
  // PCで開いたときにモバイル表示が強制されてしまう(既定値を書かない方針とも一致)
  if (s.ui) p.set("ui", s.ui);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}
