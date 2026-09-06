// ==============================================================
// 手番(バトン) — 複数台利用(変更仕様書_複数台利用.md、Issue #91)
//
//   守る不変条件はこれ1つ。
//     「データの系譜は常に1本」
//   同時に書かせないのではなく、手番を受け取るときに前の端末の成果を
//   必ず取り込む。系譜が1本なら2つの版を突き合わせる場面が存在しないため、
//   マージ・tombstone・時計ずれ対策・CAS がすべて不要になる。
//
//   判定には必ず端末ID(自動生成)を使う。グループ名や端末名は利用者が手で
//   打つ値で重複し得るため、それで判定すると2台が同時に「手番あり」になり、
//   バナーも出ないまま両方が書く(§3-2)。
//
//   ここは Drive とのやり取りを持たない純粋ロジックと状態管理に徹する。
//   実際の読み書きは gdrive.ts が担う。
// ==============================================================
import type { OwnerRecord } from "./backupTargets/types";

const LS_DEVICE_ID = "worklist3.device.id";
const LS_ENABLED = "worklist3.baton.enabled";
const LS_CACHE_OWNED = "worklist3.baton.owned";
const LS_CACHE_NAME = "worklist3.baton.ownerName";

/** 読み込み時点ではブラウザの外(テスト等)にいることがある */
function ls(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

// -------------------------------------------------------------
// 純粋ロジック(単体テストの対象)
// -------------------------------------------------------------

export type BatonRole = "owner" | "guest" | "unset";

/**
 * 手番ファイルと自分の端末IDから、この端末の立場を決める。
 * 手番ファイルが読めなかった(null)ときは「未設定」ではなく呼び出し側で
 * キャッシュを使う。ここで guest に倒すと、圏外のスマートフォンが
 * 読み取り専用になって打刻できなくなる(§4.8)。
 */
export function resolveRole(owner: OwnerRecord | null, myDeviceId: string): BatonRole {
  if (!owner || !owner.deviceId) return "unset";
  return owner.deviceId === myDeviceId ? "owner" : "guest";
}

/** この端末が localStorage とバックアップへ書いてよいか */
export function canWrite(enabled: boolean, role: BatonRole): boolean {
  if (!enabled) return true; // 手番制OFFなら従来どおり
  return role !== "guest";
}

/**
 * いま画面に出ているデータを localStorage とバックアップへ書き戻してよいか。
 * **保存してよいかの判定はここ1か所に集約する**(#109 §5)。
 *
 * viewing(閲覧中)は必ず false。見るだけの操作で手元が書き換わるなら、
 * それは #109 で潰したはずの事故そのもの。ここを迂回する保存経路を作らないこと。
 */
export function canPersist(p: {
  /** 他端末のデータを表示しているだけの状態か */
  viewing: boolean;
  /** 窓ロック(#57)で、この窓が書き手か */
  isPrimary: boolean;
  enabled: boolean;
  role: BatonRole;
}): boolean {
  if (p.viewing) return false;
  if (!p.isPrimary) return false;
  return canWrite(p.enabled, p.role);
}

/**
 * 「手元のまま引き継ぐ」(#109 §4.3)の確認に出す警告。空なら特筆すべき危険はない。
 *
 * この操作は Drive 側を手元の内容で上書きする。**相手の方が件数が多いときは、
 * 消える可能性のある差分を必ず数で見せる。** 件数が同じでも中身は違い得るので、
 * 「危険なし」とは決して言わない。
 */
export function keepWarning(mirrorCount: number | null, localCount: number): string {
  if (mirrorCount === null) {
    return "Drive の現在の件数を確認できませんでした。何が上書きされるか分かりません。";
  }
  if (mirrorCount > localCount) {
    return `Drive 側の方が ${mirrorCount - localCount} 件多く残っています。その差は失われます。`;
  }
  return "";
}

/** 退避・救出ファイルの時刻(YYYYMMDD-HHmm)を読みやすくする */
export function formatStamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(stamp);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : stamp;
}

/** バナーに出す相手の名前。端末名は任意入力なので空を許す */
export function ownerLabel(deviceName: string): string {
  const n = deviceName.trim();
  return n === "" ? "別の端末" : n;
}

/** 「3分前」。端末の時計に依存するので、呼び出し側で絶対時刻も併記すること */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 0) return "たった今";
  if (min < 1) return "1分未満前";
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

/** 絶対時刻(YYYY/MM/DD HH:MM)。相対表示と必ず併記する */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 奪取を渋らせる目安。これを過ぎたら「未送信の変更が残っている恐れ」を出す */
export const STALE_MINUTES = 30;

/**
 * 相手の最終バックアップが古いときの警告文。問題なければ空文字。
 * **これは警告であって禁止ではない。** ここで奪取を止めると、相手の
 * ブラウザデータが消えた場合に永久に手番を取れなくなる(#84 の閉じ込め)。
 */
export function staleWarning(modifiedTime: string, now: number, ownerName: string): string {
  const t = Date.parse(modifiedTime);
  if (!Number.isFinite(t)) return "";
  if (now - t < STALE_MINUTES * 60000) return "";
  return (
    `${ownerLabel(ownerName)} は ${relativeTime(modifiedTime, now)}から更新されていません。` +
    "その端末に未送信の変更が残っている可能性があります。読み込むとそれらは失われます。"
  );
}

/**
 * 「複数台で使う」をONにしたとき、何をすべきか。
 *
 *   guest のときに claim してはいけない。それは「相手のデータを読まずに
 *   手番だけ奪う」ことで、仕様書 §4.5 が明示的に禁じた経路
 *   (①読み込み ②ガード ③置換 を通さずに ④だけ起きる)にあたる。
 *   引き継ぎは必ずバナーの奪取を通す。
 */
export function enableAction(role: BatonRole): "claim" | "banner" | "noop" {
  if (role === "guest") return "banner";
  if (role === "owner") return "noop";
  return "claim";
}

/** 救出ファイル名に入れる時刻(YYYYMMDD-HHmm) */
export function rescueStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  );
}

// -------------------------------------------------------------
// 端末ID / 設定 / キャッシュ
// -------------------------------------------------------------

/** この端末の識別子。無ければ作る。表示も編集もしない */
export function deviceId(): string {
  const store = ls();
  if (!store) return "";
  let id = store.getItem(LS_DEVICE_ID);
  if (!id) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    store.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

export function batonEnabled(): boolean {
  return ls()?.getItem(LS_ENABLED) === "1";
}

export function setBatonEnabled(on: boolean): void {
  ls()?.setItem(LS_ENABLED, on ? "1" : "0");
}

/**
 * 前回わかっていた立場。起動直後はこれで即座に描画する(§4.8)。
 * 手番の移動は人の明示操作でしか起きないため、ほぼ常に正しい。
 */
export function cachedRole(): BatonRole {
  const v = ls()?.getItem(LS_CACHE_OWNED);
  if (v === "1") return "owner";
  if (v === "0") return "guest";
  return "unset";
}

export function cachedOwnerName(): string {
  return ls()?.getItem(LS_CACHE_NAME) ?? "";
}

export function cacheRole(role: BatonRole, ownerName: string): void {
  const store = ls();
  if (!store) return;
  store.setItem(LS_CACHE_OWNED, role === "owner" ? "1" : role === "guest" ? "0" : "");
  store.setItem(LS_CACHE_NAME, ownerName);
}

// -------------------------------------------------------------
// 状態(購読)
// -------------------------------------------------------------

export interface BatonState {
  /** 手番制が有効か。OFFなら以下は意味を持たない */
  enabled: boolean;
  role: BatonRole;
  /** guest のときに出す、更新中の端末の表示名 */
  ownerName: string;
  /** 相手のミラーの最終更新(ISO)。空なら不明 */
  ownerBackupAt: string;
  /** 相手のミラーの件数。null なら不明 */
  ownerCount: number | null;
  /** 裏で確認中か(UIの表示にのみ使う。編集は止めない) */
  checking: boolean;
  /** 降格して救出ファイルを書いたときのファイル名。ダイアログで見せたら消す */
  rescuedFile: string;
}

let state: BatonState = {
  enabled: batonEnabled(),
  role: batonEnabled() ? cachedRole() : "owner",
  ownerName: cachedOwnerName(),
  ownerBackupAt: "",
  ownerCount: null,
  checking: false,
  rescuedFile: "",
};

const listeners = new Set<(s: BatonState) => void>();

export function getBatonState(): BatonState {
  return state;
}

export function subscribeBaton(fn: (s: BatonState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function setBatonState(patch: Partial<BatonState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

/** この端末がいま書いてよいか。保存の直前に必ず通す */
export function batonAllowsWrite(): boolean {
  return canWrite(state.enabled, state.role);
}
