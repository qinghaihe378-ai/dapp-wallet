/// <reference types="vite/client" />

// 让 TypeScript 识别 import.meta.env（Vercel 构建也需要）

// 兜底声明：某些构建环境可能未正确加载 vite/client 的类型增强
interface ImportMetaEnv {
  readonly VITE_BIRDEYE_API_KEY?: string
  /** 独立部署的龙虾发射前端（https 或 /path）；不配置时首页「龙虾发射」进入站内 /lobster 嵌入 */
  readonly VITE_LOBSTER_LAUNCH_URL?: string
  /** 开发时 iframe 指向的龙虾 dev 源，默认 http://localhost:5174 */
  readonly VITE_LONGXIA_DEV_ORIGIN?: string
  readonly [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

