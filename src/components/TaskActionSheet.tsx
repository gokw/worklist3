// ==============================================================
// タスク操作シート(#100。変更仕様書_スマホのタスク操作.md §3-2)
//   モバイル一覧で行を長押しすると、画面下から出るボトムシート。
//   延期・翌日・前日・削除を、親指の届く下部で選べるようにする。
//
//   ・画面中央ではなく下部に出す。長押しした指の位置に依らず、いつも同じ場所に出したい
//   ・削除は既存の handleDeleteTask を通すので、従来どおり確認が出てから消える
//     (確認を省いてスマホだけ挙動を変えることはしない)
//   ・完了・開始済みは延期できない(handlePostpone の仕様)ため、押せる形で出さず理由を添える
// ==============================================================
import { useEffect } from "react";
import type { Task } from "../types";

interface Props {
  task: Task;
  /** 延期できるか。false のときは理由を添えて無効表示にする */
  canPostpone: boolean;
  onPostpone: () => void;
  onNextDay: () => void;
  onPrevDay: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** シートの項目1つ。指で押しやすい高さ(56px)を確保する */
function Item({
  label,
  icon,
  onClick,
  disabled,
  note,
  danger,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  note?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[56px] w-full items-center gap-3 px-5 text-left text-[15px] transition-colors disabled:cursor-not-allowed ${
        danger ? "text-red-600" : "text-gray-800"
      } ${disabled ? "opacity-40" : "active:bg-gray-100"}`}
    >
      <span className="w-6 shrink-0 text-center text-lg leading-none">{icon}</span>
      <span className="flex-1">
        <span className="font-medium">{label}</span>
        {note && <span className="ml-2 text-xs text-gray-500">{note}</span>}
      </span>
    </button>
  );
}

export default function TaskActionSheet({
  task,
  canPostpone,
  onPostpone,
  onNextDay,
  onPrevDay,
  onDelete,
  onClose,
}: Props) {
  // 物理キーボードのある環境(PC表示への強制切替時など)でも閉じられるようにする
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40"
      onPointerDown={onClose}
    >
      <div
        className="max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* つまみ。下端から出てきたことと、下へ払って閉じられそうなことを示す */}
        <div className="flex justify-center py-2">
          <span className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        <p className="truncate border-b border-gray-200 px-5 pb-3 text-sm font-semibold text-gray-700">
          {task.title || "(無題)"}
        </p>

        <Item
          icon="📅"
          label="延期"
          note={canPostpone ? "次の日程へ" : "完了・開始済みは延期できません"}
          disabled={!canPostpone}
          onClick={onPostpone}
        />
        <Item icon="→" label="翌日へ" onClick={onNextDay} />
        <Item icon="←" label="前日へ" onClick={onPrevDay} />
        <Item icon="🗑" label="削除" note="確認があります" danger onClick={onDelete} />

        <div className="border-t border-gray-200 p-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-lg bg-gray-100 text-sm font-semibold text-gray-700 active:bg-gray-200"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
