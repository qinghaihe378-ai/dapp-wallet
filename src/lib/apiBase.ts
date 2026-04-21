/**
 * 打包为 App 时静态资源无同源后端，可通过 VITE_API_BASE 指向已部署站点根（无尾斜杠）。
 * 本地 `vite` 开发环境不会执行 `/api` 下的服务端函数，因此在未显式配置时回退到线上站点。
 */
const DEV_FALLBACK_API_BASE = 'https://ipfs-social-1a7l.vercel.app'

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const raw = import.meta.env.VITE_API_BASE as string | undefined
  const base = raw?.trim().replace(/\/$/, '') ?? ''
  if (base) return `${base}${p}`
  if (import.meta.env.DEV) return `${DEV_FALLBACK_API_BASE}${p}`
  return p
}
