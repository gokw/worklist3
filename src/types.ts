// ==============================================================
// worklist3 のデータ構造定義
// Excel版の列構成(A〜O列)を踏襲しつつ、期限・リンク・重要度を追加
// ==============================================================

/** ステータス(Excel版のB列記号をドロップダウン化) */
export type Status = "notStarted" | "inProgress" | "done" | "suspended" | "waiting";

export const STATUS_LABELS: Record<Status, string> = {
  notStarted: "未着手",
  inProgress: "進行中",
  done: "完了",
  suspended: "中断中",
  waiting: "待ち",
};

export const ALL_STATUSES: Status[] = [
  "notStarted",
  "inProgress",
  "done",
  "suspended",
  "waiting",
];

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
  /** カテゴリ(Excel N列 theme 相当) */
  category: string;
  /** 重要度 S〜E(新規) */
  importance: Importance;
  /** ステータス(Excel B列) */
  status: Status;
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
  createdAt: string;
  updatedAt: string;
}

/** 表示ビュー: その日のすべて / その日の予定(時刻あり)のみ / 全期間 */
export type ViewMode = "dayAll" | "dayPlanned" | "everything";

/** 表示形式: 表(Excel踏襲) / カード(Todoist風) */
export type LayoutMode = "table" | "cards";
