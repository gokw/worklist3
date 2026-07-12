// ==============================================================
// URLクエリで表示状態を指定して開く/共有する(Issue #4)
//   ?mode=work|personal|all
//   &view=today|todayOnward|planned|done|everything
//   &layout=table|cards
//   &done=1|0                (完了も表示)
//   &category=...            (カテゴリ絞り込み)
// ==============================================================
import type { LayoutMode, ViewMode, WorkMode } from "../types";

const VIEWS: ViewMode[] = ["today", "todayOnward", "planned", "done", "everything"];

export interface UrlSettings {
  mode?: WorkMode;
  view?: ViewMode;
  layout?: LayoutMode;
  showDone?: boolean;
  category?: string;
}

/** 現在のURLから設定を読む(不正な値は無視) */
export function readUrlSettings(): UrlSettings {
  const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const s: UrlSettings = {};

  const mode = p.get("mode");
  if (mode === "work" || mode === "personal" || mode === "all") s.mode = mode;

  const view = p.get("view");
  if (view && VIEWS.includes(view as ViewMode)) s.view = view as ViewMode;

  const layout = p.get("layout");
  if (layout === "table" || layout === "cards") s.layout = layout;

  const done = p.get("done");
  if (done === "1" || done === "true") s.showDone = true;
  else if (done === "0" || done === "false") s.showDone = false;

  const category = p.get("category");
  if (category) s.category = category;

  return s;
}

/** 現在の表示状態をURLへ反映(履歴は汚さず置換) */
export function writeUrlSettings(s: Required<Omit<UrlSettings, "category">> & { category: string }) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  p.set("mode", s.mode);
  p.set("view", s.view);
  p.set("layout", s.layout);
  p.set("done", s.showDone ? "1" : "0");
  if (s.category) p.set("category", s.category);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}
