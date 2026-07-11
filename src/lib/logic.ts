// ==============================================================
// タスクのライフサイクルロジック
// Excel版 modTask(開始・終了・中断)/ 繰り返し生成のロジックを踏襲
// ==============================================================
import type { DerivedStatus, RepeatConfig, Task } from "../types";
import {
  addToDate,
  hhmmToMin,
  minToHHMM,
  nextWeekdayAfter,
  nowHHMM,
  todayStr,
} from "./date";

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新規タスクの雛形を作る */
export function createTask(partial: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: newId(),
    title: "",
    category: "",
    importance: "C",
    waiting: false,
    estimateMin: 0,
    memos: ["", "", ""],
    links: [],
    createdAt: now,
    updatedAt: now,
    date: todayStr(),
    ...partial,
  };
}

/** 表示用ステータスを実績から自動判定する(Excel版と同じ考え方) */
export function derivedStatus(task: Task): DerivedStatus {
  if (task.actEnd) return "done";
  if (task.actStart) return "running";
  if (task.waiting) return "waiting";
  return "notStarted";
}

// ---------- 計算列(Excel版 G/J/O 列の数式を踏襲) ----------

/** 終了予定 = 開始予定 + 見積(Excel G列) */
export function planEnd(task: Task): string | undefined {
  const start = hhmmToMin(task.planStart);
  if (start === undefined || !task.estimateMin) return undefined;
  return minToHHMM(start + task.estimateMin);
}

/** 実績時間(分)= 終了実績 − 開始実績(Excel J列)。日をまたいだら24h折り返し */
export function actMin(task: Task): number | undefined {
  const s = hhmmToMin(task.actStart);
  const e = hhmmToMin(task.actEnd);
  if (s === undefined || e === undefined) return undefined;
  return e >= s ? e - s : e - s + 1440;
}

/** 残り時間 = 終了済みなら0、未終了なら見積(Excel O列) */
export function remainMin(task: Task): number {
  return task.actEnd ? 0 : task.estimateMin;
}

/** 期限切れか(完了タスクは対象外) */
export function isOverdue(task: Task): boolean {
  return !!task.deadline && !task.actEnd && task.deadline < todayStr();
}

/** 期限当日か(完了タスクは対象外) */
export function isDueToday(task: Task): boolean {
  return !!task.deadline && !task.actEnd && task.deadline === todayStr();
}

// ---------- 開始・終了 ----------

/** タスク開始: 開始実績=今。待ちフラグは解除(Excel StartTask 踏襲) */
export function startTask(task: Task, time?: string): Task {
  return {
    ...task,
    actStart: time ?? nowHHMM(),
    actEnd: undefined,
    waiting: false,
    date: task.date ?? todayStr(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * タスク終了: 終了実績=今、待ちフラグは自動解除。
 * 繰り返し設定があれば次回タスクも生成して返す(Excel EndTask 踏襲)。
 */
export function endTask(
  task: Task,
  time?: string
): { updated: Task; next?: Task } {
  const updated: Task = {
    ...task,
    actEnd: time ?? nowHHMM(),
    waiting: false,
    updatedAt: new Date().toISOString(),
  };
  const next = task.repeat ? generateNextOccurrence(updated) : undefined;
  return { updated, next };
}

/** 繰り返し設定から次回タスクを生成する */
export function generateNextOccurrence(task: Task): Task {
  const repeat = task.repeat as RepeatConfig;
  // 定期=元の日付基準 / 完了トリガー=完了日(今日)基準
  const baseDate =
    repeat.mode === "afterComplete" ? todayStr() : task.date ?? todayStr();

  let nextDate: string;
  if (repeat.unit === "week" && repeat.weekdays && repeat.weekdays.length > 0) {
    nextDate = nextWeekdayAfter(baseDate, repeat.weekdays);
  } else {
    nextDate = addToDate(baseDate, repeat.unit, repeat.interval);
  }

  return createTask({
    title: task.title,
    category: task.category,
    importance: task.importance,
    estimateMin: task.estimateMin,
    date: nextDate,
    // Excel版: R=開始予定をコピー / r=しない
    planStart: repeat.copyPlanStart ? task.planStart : undefined,
    repeat,
    memos: [...task.memos],
    links: [...task.links],
    // 期限があれば同じ間隔だけずらす
    deadline: task.deadline
      ? addToDate(task.deadline, repeat.unit, repeat.interval)
      : undefined,
  });
}

// ---------- 中断(割り込み) Excel InterruputTask 踏襲 ----------

export interface InterruptResult {
  /** 元タスク: 消化分として確定(見積=実績、終了=今、完了) */
  consumed: Task;
  /** 残りタスク: 残見積を引き継いだ未着手タスクとして生成 */
  remainder: Task;
  /** 割込みタスク(名前が入力された場合のみ): 即開始状態で生成 */
  interrupt?: Task;
}

export function interruptTask(
  task: Task,
  interruptTitle?: string,
  interruptEstimateMin?: number
): InterruptResult {
  const now = nowHHMM();
  const ended: Task = {
    ...task,
    actEnd: now,
    waiting: false,
    updatedAt: new Date().toISOString(),
  };
  const consumedMin = actMin(ended) ?? 0;
  const remainingMin = Math.max(task.estimateMin - consumedMin, 0);

  // 1) 元タスク: 見積を「消化した分」に書き換えて確定
  const consumed: Task = { ...ended, estimateMin: consumedMin };

  // 2) 残りタスク: 開始予定・実績をクリアし、見積=残り
  const remainder = createTask({
    title: task.title,
    category: task.category,
    importance: task.importance,
    date: task.date ?? todayStr(),
    estimateMin: remainingMin,
    deadline: task.deadline,
    repeat: task.repeat,
    memos: [...task.memos],
    links: [...task.links],
    parentId: task.parentId,
  });

  // 3) 割込みタスク(任意): 開始予定=今、開始実績=今 で即スタート
  let interrupt: Task | undefined;
  if (interruptTitle && interruptTitle.trim() !== "") {
    interrupt = createTask({
      title: interruptTitle.trim(),
      category: task.category,
      date: todayStr(),
      estimateMin: interruptEstimateMin ?? 0,
      planStart: now,
      actStart: now,
    });
  }

  return { consumed, remainder, interrupt };
}

// ---------- 待ち(Excel版 WaitTask 踏襲) ----------

/** 待ちフラグのトグル(未完了タスク用) */
export function toggleWaiting(task: Task): Task {
  return { ...task, waiting: !task.waiting, updatedAt: new Date().toISOString() };
}

/**
 * 完了タスクから「待ちタスク」を複製する(Excel版 WaitTask 踏襲)。
 * 見積=0、開始予定・実績はクリアし、待ちフラグを立てる。
 */
export function createWaitCopy(task: Task): Task {
  return createTask({
    title: task.title,
    category: task.category,
    importance: task.importance,
    date: task.date,
    estimateMin: 0,
    deadline: task.deadline,
    memos: [...task.memos],
    links: [...task.links],
    parentId: task.parentId,
    waiting: true,
  });
}

// ---------- 分解 ----------

/** 「準備」タスクを追加(例: 会議に対する準備時間) */
export function createPrepTask(parent: Task, estimateMin: number): Task {
  return createTask({
    title: `【準備】${parent.title}`,
    category: parent.category,
    importance: parent.importance,
    date: parent.date,
    estimateMin,
    deadline: parent.deadline,
    parentId: parent.id,
  });
}

// ---------- 連続開始時刻の自動設定(Excel SetSequentialStartHHMM 踏襲) ----------

/**
 * 複数タスクへ、見積時間を積み上げて連続的に開始予定時刻を設定する。
 * firstStart: 最初のタスクの開始時刻(HH:MM)
 */
export function setSequentialStart(tasks: Task[], firstStart: string): Task[] {
  let cursor = hhmmToMin(firstStart) ?? 0;
  return tasks.map((t) => {
    const updated: Task = {
      ...t,
      planStart: minToHHMM(cursor),
      updatedAt: new Date().toISOString(),
    };
    cursor += t.estimateMin;
    return updated;
  });
}
