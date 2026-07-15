// ==============================================================
// URLクエリで表示状態を指定して開く/共有する(Issue #4)
//   ?mode=work|personal|all
//   &view=todayOnward|today|everything|custom   (期間)
//   &from=YYYY-MM-DD &to=YYYY-MM-DD             (view=custom の範囲。片側省略可)
//   &done=all|onlyDone|hideDone                 (完了の扱い)
//   &planned=1|0                                (予定のみ=開始予定時刻ありに絞る)
//   &category=...                               (カテゴリ絞り込み)
//   &q=...                                      (タスク名フィルタ。/パターン/ で正規表現)
// ==============================================================
import type { DoneFilter, ViewMode, WorkMode } from "../types";

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
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}
