/// <reference types="vite/client" />

// vite.config.ts の define で埋め込むビルド情報(Issue #41)
declare const __BUILD_DATE__: string; // 最新コミット日時(ISO8601)
declare const __BUILD_HASH__: string; // 短縮コミットハッシュ
