// ==============================================================
// タスクのリンク解析(Issue #45)
//   リンクを「Webリンク(http/https 等)」と「ローカルパス」に判別する。
//   ローカルパスはブラウザから直接開けない(https 由来の file:// はブラウザが
//   セキュリティ上ブロックする)ため、クリック時にネイティブパス(F:\...)を
//   クリップボードへコピーし、エクスプローラのアドレス欄へ貼る運用にする。
// ==============================================================

export type LinkKind = "web" | "local";

export interface ParsedLink {
  kind: LinkKind;
  /** 表示・tooltip 用の文字列 */
  display: string;
  /** web: そのままの href / local: コピーするネイティブパス(F:\...) */
  value: string;
  /** local のとき: 拡張子ありならファイル(true)、なければフォルダ(false) */
  isFile: boolean;
}

/** 前後の引用符(" または ')を外してトリムする */
function unquote(s: string): string {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

const DRIVE_RE = /^[A-Za-z]:[\\/]/; // F:\ または F:/
const UNC_RE = /^\\\\/; // \\server\share
const FILE_URI_RE = /^file:\/\//i;

/** file:///F:/a%20b や file://server/share を Windows ネイティブ表記へ変換 */
function fileUriToNative(uri: string): string {
  let p = uri.replace(FILE_URI_RE, ""); // 先頭 file:// を除去
  const isUnc = p.startsWith("/") ? false : true; // file://server/... は host 付き(UNC)
  // file:///F:/... は先頭にスラッシュが1つ余分に付く。UNC(host付き)はそのまま活かす
  if (!isUnc) p = p.replace(/^\/+/, "");
  try {
    p = decodeURI(p);
  } catch {
    /* 壊れた % エスケープはそのまま扱う */
  }
  p = p.replace(/\//g, "\\");
  if (isUnc) p = "\\\\" + p.replace(/^\\+/, ""); // \\server\share へ
  return p;
}

/** クォート除去後の文字列がローカルパスか */
function isLocalPath(s: string): boolean {
  return DRIVE_RE.test(s) || UNC_RE.test(s) || FILE_URI_RE.test(s);
}

/** 末尾要素に拡張子があればファイル扱い(.mp4 など。末尾区切りのフォルダは false) */
function looksLikeFile(nativePath: string): boolean {
  const last = nativePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return /\.[^.\\/\s]{1,10}$/.test(last);
}

/**
 * リンク文字列を解析する。
 *  - Web(http/https/mailto 等) はそのまま href として扱う(従来どおり新規タブで開く)
 *  - ローカルパス(ドライブ/UNC/file://、引用符囲みも可)はネイティブパスへ正規化する
 */
export function parseLink(raw: string): ParsedLink {
  const s = unquote(raw);
  if (isLocalPath(s)) {
    const native = FILE_URI_RE.test(s) ? fileUriToNative(s) : s.replace(/\//g, "\\");
    return { kind: "local", display: native, value: native, isFile: looksLikeFile(native) };
  }
  const web = raw.trim();
  return { kind: "web", display: web, value: web, isFile: false };
}
