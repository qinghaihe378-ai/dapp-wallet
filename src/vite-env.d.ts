/// <reference types="vite/client" />

// 让 TypeScript 识别 import.meta.env（Vercel 构建也需要）

// 兜底声明：某些构建环境可能未正确加载 vite/client 的类型增强
interface ImportMetaEnv {
  readonly VITE_BIRDEYE_API_KEY?: string
  /** 独立部署的龙虾发射前端根地址（https），可选 */
  readonly VITE_LOBSTER_LAUNCH_URL?: string
  readonly [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

