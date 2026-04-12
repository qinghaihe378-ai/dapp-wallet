import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

/** 与主站同域部署时使用，例如 /longxia/；本地开发不设环境变量即为 / */
function longxiaBase(): string {
  const raw = process.env.VITE_LONGXIA_BASE?.trim()
  if (!raw || raw === "/") return "/"
  return raw.endsWith("/") ? raw : `${raw}/`
}

export default defineConfig({
  base: longxiaBase(),
  plugins: [react()],
  // 与主站 dapp-wallet（默认 5173）错开，避免浏览器一直打开 5173 却仍是龙虾 dev
  server: {
    port: 5174,
    strictPort: true
  }
})

