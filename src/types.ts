// ==============================================================
// worklist3 のデータ構造定義
// Excel版の列構成(A〜O列)を踏襲しつつ、期限・リンク・重要度を追加
// ==============================================================

/**
 * 表示用ステータス(Excel版と同じく実績から自動判定する)
 *   完了=終了実績あり / 進行中=開始実績のみ / 待ち=待ちフラグ / 未着手=それ以外
 * ユーザーが自分で設定するのは「待ち」フラグ(Excel版 B列の "w")のみ。
 */
export type DerivedStatus = "notStarted" | "running" | "waiting" | "done";

export const DERIVED_STATUS_LABELS: Record<DerivedStatus, string> = {
  notStarted: "未着手",
  running: "進行中",
  waiting: "待ち",
  done: "完了",
};

/** 重要度 S(最高)〜E の6段階 */
export type Importance = "S" | "A" | "B" | "C" | "D" | "E";
export const ALL_IMPORTANCES: Importance[] = ["S", "A", "B", "C", "D", "E"];

/** 繰り返し設定(Excel版 C列の [r/R][d/w/m/y]数字 をフォーム化) */
export interface RepeatConfig {
  /** schedule: 定期(元の日付基準) / afterComplete: 完了トリガー(完了日基準) */
  mode: "schedule" | "afterComplete";
  unit: "day" | "week" | "month" | "year";
  interval: number;
  /** 毎週◯曜日(0=日〜6=土)。unit==="week" のときのみ有効。空なら単純なN週間後 */
  weekdays?: number[];
  /**
   * 毎月◯日 / 毎年◯月◯日 の「日」(1〜31)。unit==="month"/"year" のとき有効。
   * 指定があれば固定日として扱い、次回日が土日祝なら前営業日へ丸める(#30)。
   * 末日を超える指定(2月の31日など)はその月の末日にクランプ。
   * 空なら従来どおり「基準日の日を維持して N か月/年後」。
   */
  dayOfMonth?: number;
  /** 毎年◯月(1〜12)。unit==="year" のとき dayOfMonth と併用(#30)。 */
  month?: number;
  /** Excel版 R=開始予定時刻を次回にコピーする / r=しない */
  copyPlanStart: boolean;
}

export const REPEAT_UNIT_LABELS: Record<RepeatConfig["unit"], string> = {
  day: "日",
  week: "週",
  month: "月",
  year: "年",
};

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export interface Task {
  id: string;
  /** タスク名(Excel D列) */
  title: string;
  /** 仕事のタスクか個人のタスクか(ビュー切替用。カテゴリとは独立) */
  scope: TaskScope;
  /** カテゴリ(Excel N列 theme 相当)。分類・集計のためのラベル(例: 運用業務、稟議チェック) */
  category: string;
  /** 重要度 S〜E(新規) */
  importance: Importance;
  /** 待ちフラグ(Excel B列の "w" 相当)。Wキーでトグル、終了時に自動解除 */
  waiting: boolean;
  /** いつやるか=日付部 YYYY-MM-DD(Excel A列)。未設定なら毎日「その日のタスク」扱い */
  date?: string;
  /** いつやるか=時刻部 HH:MM(Excel F列 開始予定)。設定があれば「予定」 */
  planStart?: string;
  /** 見積時間(分)(Excel E列) */
  estimateMin: number;
  /** 開始実績 HH:MM(Excel H列) */
  actStart?: string;
  /** 終了実績 HH:MM(Excel I列) */
  actEnd?: string;
  /** 期限 YYYY-MM-DD(worklist3で新規追加) */
  deadline?: string;
  /** 繰り返し設定(Excel C列) */
  repeat?: RepeatConfig;
  /** メモ(Excel K/L/M列の3つを踏襲) */
  memos: string[];
  /** リンク最大5件(新規) */
  links: string[];
  /** 分割・準備タスクの親タスクID */
  parentId?: string;
  /**
   * Googleカレンダーへ同期済みのイベントID(未同期なら undefined)。
   * これがあれば patch(更新)、無ければ insert(新規)。カレンダー連携でのみ使う。
   */
  gcalEventId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 表示ビュー = 「いつの分を見るか」(期間の指定に特化)。
 *   todayOnward … 今日以降のタスク全て + 繰越(既定)
 *   today       … 今日(選択日)のタスク全て + 繰越(前日以前の未完了)
 *   everything  … すべて(棚卸し用)
 *   custom      … 開始日〜終了日を指定(片側だけの指定も可)
 * 完了の扱いは DoneFilter、開始予定時刻の有無は「予定のみ」トグルで別軸に分ける。
 */
export type ViewMode = "todayOnward" | "today" | "everything" | "custom";

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  todayOnward: "今日以降",
  today: "今日",
  everything: "全期間",
  custom: "カスタム",
};

/**
 * 完了タスクの扱い(期間とは独立した軸)。
 *   all      … 完了も未完了も出す(既定)
 *   onlyDone … 完了したものだけ(振り返り・分析用。旧「完了」ビュー相当)
 *   hideDone … 完了を隠す(残りの作業に集中したいとき)
 */
export type DoneFilter = "all" | "onlyDone" | "hideDone";

export const DONE_FILTER_LABELS: Record<DoneFilter, string> = {
  all: "すべて",
  onlyDone: "完了のみ",
  hideDone: "完了を隠す",
};

/**
 * タスクが仕事のものか個人のものか(scope)。カテゴリとは独立した軸。
 * 「仕事中は仕事だけ／休日は個人だけ」というビュー切替のために各タスクが持つ。
 */
export type TaskScope = "work" | "personal";

export const SCOPE_LABELS: Record<TaskScope, string> = {
  work: "仕事",
  personal: "個人",
};

/** 表示モード(仕事/個人/すべて)。scope を絞り込むためのビュー */
export type WorkMode = "work" | "personal" | "all";

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  work: "💼 仕事",
  personal: "🏠 個人",
  all: "すべて",
};

/**
 * 表示形式。現在は「表ライト」(高密度)のみを使う。
 * 「表形式」(table) と「カード形式」(cards) は 2026-07 に一覧から外した。
 * コンポーネント(TaskTable の dense=false / TaskCards)とこの型の値は残してあるので、
 * Toolbar の切替チップと App の T キーのコメントを外せば復活できる。
 */
export type LayoutMode = "table" | "tableLight" | "cards";

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  table: "表形式",
  tableLight: "表ライト",
  cards: "カード形式",
};
