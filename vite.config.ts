import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // GitHub Pages は https://gokw.github.io/worklist3/ で配信されるため、
  // アセットの参照を /worklist3/ 起点にする(これが無いと本番で真っ白になる)。
  base: "/worklist3/",
  plugins: [react(), tailwindcss()],
});
