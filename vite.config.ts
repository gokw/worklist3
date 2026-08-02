import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ビルド時に「最終更新日(=最新コミット日)」と短縮ハッシュを埋め込む(Issue #41)。
// 手動保守は不要で、push→自動デプロイのたびに正しい値が入る。
// git が使えない環境(まれ)では現在時刻/devにフォールバックする。
function gitBuildInfo(): { date: string; hash: string } {
  try {
    return {
      date: execSync("git log -1 --format=%cI").toString().trim(), // ISO8601(タイムゾーン付き)
      hash: execSync("git log -1 --format=%h").toString().trim(),
    };
  } catch {
    return { date: new Date().toISOString(), hash: "dev" };
  }
}
const buildInfo = gitBuildInfo();

export default defineConfig({
  // GitHub Pages は https://gokw.github.io/worklist3/ で配信されるため、
  // アセットの参照を /worklist3/ 起点にする(これが無いと本番で真っ白になる)。
  base: "/worklist3/",
  define: {
    __BUILD_DATE__: JSON.stringify(buildInfo.date),
    __BUILD_HASH__: JSON.stringify(buildInfo.hash),
  },
  plugins: [react(), tailwindcss()],
});
