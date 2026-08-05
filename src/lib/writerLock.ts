// ==============================================================
// 単一書き手ロック(多重起動によるデータ巻き戻りの防止)。Issue #57
//   Web Locks API で "書き手ロック" を1つだけ持たせ、保持できた窓だけを
//   編集可(primary)、他は読み取り専用(secondary)にする。
//     - 検知      : 窓を開いた瞬間にロックを要求。取れれば primary、取れねば secondary
//     - 解放      : 窓を閉じ/落とした瞬間にブラウザが自動解放(ハートビート不要)
//     - 昇格      : primary が消えると待ち行列の secondary が自動で昇格
//     - 引き継ぎ  : 利用者操作で BroadcastChannel 経由に現 primary へ解放を促す
//   未対応環境では supported=false のまま常に primary へ縮退(=今日と同じ無保護)。
// ==============================================================

export interface WriterState {
  /** Web Locks API が使える環境か */
  supported: boolean;
  /** この窓が書き手(編集可)か */
  isPrimary: boolean;
}

const LOCK_NAME = "worklist3.writer";
const CHANNEL_NAME = "worklist3.writer";

let state: WriterState = {
  supported:
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { locks?: unknown }).locks !== "undefined",
  isPrimary: false,
};

const listeners = new Set<(s: WriterState) => void>();
/** startWriterLock を1タブで一度だけ実行するためのガード(StrictModeの二重実行・再マウント対策) */
let started = false;
/** 保持中ロックの解放関数(request のコールバックが返す Promise を resolve する) */
let releaseHeld: (() => void) | null = null;
let channel: BroadcastChannel | null = null;
/** secondary→primary へ昇格した瞬間に呼ぶフック(App が最新データの再読込を差し込む) */
let onPromote: ((isHandover: boolean) => void) | null = null;

function setState(patch: Partial<WriterState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getWriterState(): WriterState {
  return state;
}

export function subscribeWriter(fn: (s: WriterState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 昇格時フックを登録する。App 側で「陳腐化した自メモリを捨て、localStorage から
 * 最新を読み直す」処理を差し込む(§4.4)。昇格は必ずこの再読込を伴わせる。
 * 引数 isHandover=true は「他窓から引き継いだ昇格」(=起動直後の初回取得ではない)。
 */
export function setOnPromote(fn: (isHandover: boolean) => void): void {
  onPromote = fn;
}

function becomePrimary(isHandover: boolean): void {
  setState({ isPrimary: true }); // 先に書き手フラグを立ててから
  onPromote?.(isHandover); // 最新データへ収束(この後の保存はこの最新に対して行われる)
}

/**
 * 書き手ロックを要求して待ち行列に並ぶ。
 *   - 誰も持っていなければ即コールバック → primary
 *   - 誰かが持っていれば待機し、その窓が閉じ/落ちたら自動でここへ来る → 昇格
 * コールバックは「解放されるまで pending のままの Promise」を返してロックを保持し続ける。
 */
function acquire(isHandover: boolean): void {
  void navigator.locks.request(
    LOCK_NAME,
    { mode: "exclusive" },
    () =>
      new Promise<void>((resolve) => {
        releaseHeld = resolve;
        becomePrimary(isHandover);
      })
  );
}

/**
 * 起動時に1回呼ぶ。未対応環境では常に primary(今日と同じ挙動)へ縮退する。
 * 二重呼び出し(StrictModeの再マウント等)ではロックを多重取得しないよう1回だけ実行する。
 */
export async function startWriterLock(): Promise<void> {
  if (started) return;
  started = true;
  if (!state.supported) {
    setState({ isPrimary: true }); // フォールバック: 無保護だが読み取り専用で固まらせない
    return;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => {
      // 引き継ぎ要求を受けた primary は、自発的に読み取り専用へ回ってロックを解放する。
      // 解放したロックは待ち行列の要求元へ FIFO で渡る(§4.6)。
      if (e.data?.type === "release-please" && state.isPrimary) {
        setState({ isPrimary: false });
        const release = releaseHeld;
        releaseHeld = null;
        release?.();
        acquire(true); // 自分も末尾で待機し直す。次の昇格は引き継ぎ扱い
      }
    };
  } catch {
    channel = null; // BroadcastChannel 不可でも単一書き手の主機能は動く(引き継ぎのみ不可)
  }
  // 起動時点で他窓が保持していれば、この窓は待たされる=昇格は「引き継ぎ」扱い。
  // (query は参考値。取り違えても実害はトースト文言だけ)
  let startsSecondary = false;
  try {
    const q = await navigator.locks.query();
    startsSecondary = (q.held ?? []).some((l) => l.name === LOCK_NAME);
  } catch {
    /* query 不可でも初回取得として続行 */
  }
  acquire(startsSecondary);
}

/**
 * secondary が「この窓で編集する」を押したとき、現 primary に解放を促す。
 * primary が解放すると、待ち行列で待っているこの窓が昇格する。
 */
export function requestTakeover(): void {
  if (state.isPrimary) return;
  try {
    channel?.postMessage({ type: "release-please" });
  } catch {
    /* 送れなくても致命ではない(相手が閉じれば自動昇格する) */
  }
}
