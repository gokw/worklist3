// ==============================================================
// バックアップ先(保存先)の抽象
//   backup.ts が持つ「方針」— デバウンス・サニティガード・ローテーション判定・
//   状態通知・スヌーズ — は保存先によらず共通で、ここが差し替えるのは
//   「どこへ、どう書くか」だけ。
//   これにより、テスト用のフェイク保存先を差せば方針ロジックを単体検証できる。
// ==============================================================

export type BackupTargetId = "fsa" | "gdrive";

/**
 * 書き出す中身。整形の有無は保存先が決める
 *   ・非圧縮で保管するなら整形あり(人が読める・そのままインポートできる)
 *   ・圧縮して保管するなら整形なし(どうせ読めないので容量を優先)
 * 400KB規模を毎回2通り作るのは無駄なので、必要な方だけ作らせる。
 */
export interface BackupBody {
  /** 件数。サニティガードと圧縮後の検証に使う */
  count: number;
  toJson(pretty: boolean): string;
}

/** 日次コピー1件。一覧(掃除・復元)と削除で使う */
export interface DailyEntry {
  /** 保存先内での識別子(FSAはファイル名、DriveはファイルID) */
  key: string;
  /** 表示用のファイル名 */
  name: string;
  /** YYYY-MM-DD */
  date: string;
}

/** 接続操作の結果。失敗理由の解釈は backup.ts 側で行う */
export interface ConnectResult {
  ok: boolean;
  /** 接続先の表示名(フォルダ名 / 端末名) */
  displayName: string;
  /** 失敗理由。空なら異常なし */
  problem?: string;
  /** ユーザー操作による再接続が必要か */
  needsReconnect?: boolean;
}

export interface BackupTarget {
  readonly id: BackupTargetId;
  /** UI表示名(「ローカルフォルダ」「Google ドライブ」) */
  readonly label: string;
  /** この環境で使えるか。使えなければ選択肢に出さない */
  readonly supported: boolean;
  /** 接続先の表示名(フォルダ名 / 端末名)。未接続なら空 */
  readonly displayName: string;
  /** 圧縮して保管するか。保存先ごとに既定が違う(ローカル=非圧縮 / Drive=圧縮) */
  readonly compress: boolean;
  /** 保管形式を切り替える。選択は保存先ごとに記憶する */
  setCompress(on: boolean): void;
  /**
   * 旧形式(切り替える前)のミラーを片付ける。ミラーは常に1つだけ残す。
   * 2つ並ぶと、復元のときにどちらが最新か分からなくなるため。
   */
  removeStaleMirror(): Promise<void>;
  /**
   * 連続変更をまとめる待ち時間。
   * ローカルは即時でよいが、ネットワーク越しの保存先は通信量と電池のために長くとる。
   */
  readonly debounceMs: number;

  /** ユーザー操作起点の接続(フォルダ選択 / OAuth) */
  connect(): Promise<ConnectResult>;
  /** 起動時の復帰。非対話(権限やトークンの再要求はしない) */
  restore(): Promise<ConnectResult>;
  /** 権限・トークン切れからの再接続。ユーザー操作起点なので再要求してよい */
  reconnect(): Promise<ConnectResult>;
  /** 接続を解除する。保存先のファイルは消さない */
  disconnect(): Promise<void>;

  /**
   * 書き込み直前の非対話チェック(FSA=権限、Drive=トークン)。
   * false なら書かずに「再接続してください」に落とす。
   */
  ensureWritable(): Promise<boolean>;

  /** 既存ミラーの件数。サニティガードの比較元。取れなければ null */
  readMirrorCount(): Promise<number | null>;
  /** ミラー(最新の全件)を書く */
  writeMirror(body: BackupBody): Promise<void>;
  /** その日の日次コピーを書く */
  writeDaily(body: BackupBody, date: string): Promise<void>;
  /** 日次コピーの一覧。ローテーションの掃除と復元一覧で共有する */
  listDaily(): Promise<DailyEntry[]>;
  /** 日次コピーを1件消す(Drive はゴミ箱へ移す) */
  deleteDaily(entry: DailyEntry): Promise<void>;
}

/**
 * 日次コピーのファイル名の規約。
 *   <prefix>-YYYY-MM-DD.json / .json.gz
 * prefix は保存先ごとに違う(ローカルは "worklist3"、Drive は端末名を含む)。
 *
 * 圧縮の導入で拡張子が増えたため、判定は .gz を含めて行う。
 * ここが一致しないと古い世代が消えず無限に増えるので、
 * 書き込み側と掃除側で必ず同じ規約を使うこと。
 */
export function dailyFileName(prefix: string, date: string, compress: boolean): string {
  return `${prefix}-${date}.json${compress ? ".gz" : ""}`;
}

/** 日次コピーのファイル名から日付を取り出す。規約外の名前なら null(＝触らない) */
export function dailyFileDate(prefix: string, name: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${escaped}-(\\d{4}-\\d{2}-\\d{2})\\.json(\\.gz)?$`).exec(name);
  return m ? m[1] : null;
}

/** ミラーのファイル名の規約 */
export function mirrorFileName(prefix: string, compress: boolean): string {
  return `${prefix}.json${compress ? ".gz" : ""}`;
}
