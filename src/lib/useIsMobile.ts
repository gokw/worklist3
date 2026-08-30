// ==============================================================
// モバイル表示にするかの判定
//   ・既定は画面幅で自動(640px未満=モバイル。Tailwind の sm に合わせる)
//   ・URLクエリ ?ui=mobile|desktop で強制できる(urlParams.ts)
//   判定は表示にだけ影響し、データ・絞り込み・並び順・保存には一切影響しない。
// ==============================================================
import { useEffect, useState } from "react";

/** URLからの強制指定。undefined = 自動 */
export type UiOverride = "mobile" | "desktop" | undefined;

/** これ未満をモバイルとみなす */
export const MOBILE_MAX_WIDTH = 640;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH - 1}px)`;

/**
 * 画面が狭いかどうかと強制指定から、モバイル表示にするかを決める。
 * 外部依存の無い純粋関数なのでテスト対象。
 */
export function shouldUseMobile(narrow: boolean, override: UiOverride): boolean {
  if (override === "mobile") return true;
  if (override === "desktop") return false;
  return narrow;
}

/** 画面が狭いかを購読する。回転・リサイズに追従する */
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    // matchMedia が無い環境ではデスクトップ表示のままにする(縮退)
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setNarrow(mql.matches);
    onChange(); // 初期化時とのズレを埋める
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return narrow;
}

/** モバイル表示にするか(強制指定があればそれに従う) */
export function useIsMobile(override: UiOverride): boolean {
  return shouldUseMobile(useNarrowScreen(), override);
}
