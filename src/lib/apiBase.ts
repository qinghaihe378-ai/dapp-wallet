/**
 * 打包为 App 时静态资源无同源后端，可通过 VITE_API_BASE 指向已部署站点根（无尾斜杠），
 * 例如 https://your-app.vercel.app
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const raw = import.meta.env.VITE_API_BASE as string | undefined
  const base = raw?.trim().replace(/\/$/, '') ?? ''
  return base ? `${base}${p}` : p
}
