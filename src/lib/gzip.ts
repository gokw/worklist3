// ==============================================================
// gzip 圧縮・展開
//   バックアップとエクスポートの保管形式、およびインポートの読み込みで使う。
//   ・ブラウザ標準の CompressionStream / DecompressionStream のみ(依存ライブラリ無し)
//   ・判別は拡張子ではなく先頭2バイトのマジックナンバー(1F 8B)で行う。
//     拡張子が変わっていても読めるようにするため。
//   ・「壊れた控えを書いたことに気づかない」のが最悪なので、書き込み前の検証を用意する
//     (サニティガードと同じ思想。数十KBなので実行コストは無視できる)。
//   外部依存が無い純粋ロジックなのでテスト対象(gcalMap.ts と同じ位置づけ)。
// ==============================================================

/** この環境で gzip が使えるか。使えなければ圧縮の選択肢自体を出さない */
export const gzipSupported =
  typeof CompressionStream === "function" && typeof DecompressionStream === "function";

/** gzip ファイルの先頭2バイト */
const MAGIC = [0x1f, 0x8b] as const;

/** 先頭2バイトを見て gzip かどうかを判定する(拡張子は見ない) */
export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1];
}

/** ストリームを通した結果をまとめて受け取る */
async function pipe(input: BlobPart, transform: TransformStream): Promise<Response> {
  return new Response(new Blob([input]).stream().pipeThrough(transform));
}

/** 文字列を gzip 圧縮する */
export async function gzipText(text: string): Promise<Uint8Array> {
  const res = await pipe(text, new CompressionStream("gzip"));
  return new Uint8Array(await res.arrayBuffer());
}

/** gzip を展開して文字列にする */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const res = await pipe(bytes, new DecompressionStream("gzip"));
  return await res.text();
}

/**
 * バックアップ/エクスポートのファイル内容を、圧縮の有無を問わず JSON 文字列にして返す。
 * インポートはこれを通してから既存の経路(isValid → migrateTask → マージ)へ合流する。
 */
export async function decodeBackupBytes(bytes: Uint8Array): Promise<string> {
  if (!looksGzipped(bytes)) return new TextDecoder().decode(bytes);
  if (!gzipSupported) throw new Error("この環境では圧縮ファイルを展開できません");
  return await gunzipText(bytes);
}

/**
 * 圧縮結果が確かに読み戻せるかを、書き込む前に確かめる。
 * 問題があればその理由を返す(問題なければ空文字)。guardReason と同じ流儀。
 *   ・展開できるか
 *   ・JSON として解釈できるか
 *   ・配列で、件数が期待どおりか(取りこぼしの検知)
 */
export async function verifyGzipped(bytes: Uint8Array, expectedCount: number): Promise<string> {
  let text: string;
  try {
    text = await gunzipText(bytes);
  } catch {
    return "圧縮した控えを展開できませんでした";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "圧縮した控えがJSONとして読めませんでした";
  }
  if (!Array.isArray(parsed)) return "圧縮した控えの中身が配列ではありません";
  if (parsed.length !== expectedCount)
    return `圧縮した控えの件数が合いません(${expectedCount}件のはずが${parsed.length}件)`;
  return "";
}
