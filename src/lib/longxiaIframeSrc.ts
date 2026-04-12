/**
 * 应用内「龙虾」iframe 地址（不引入 wagmi，与主站隔离）。
 * - 若配置了 VITE_LOBSTER_LAUNCH_URL 且为 http(s) 绝对地址：嵌入该站（独立部署）。
 * - 若为以 / 开头的路径：同域拼接。
 * - 否则生产环境嵌入同域 /longxia/；开发环境嵌入 VITE_LONGXIA_DEV_ORIGIN（未配则默认同 host 的 5175 端口）。
 */
export function getLongxiaIframeSrc(): string {
  const raw = import.meta.env.VITE_LOBSTER_LAUNCH_URL?.trim()
  if (raw) {
    if (/^https?:\/\//i.test(raw)) {
      return raw.endsWith('/') ? raw : `${raw}/`
    }
    if (raw.startsWith('/') && typeof window !== 'undefined') {
      try {
        return new URL(raw, window.location.origin).href
      } catch {
        /* fall through */
      }
    }
  }
  if (import.meta.env.DEV) {
    const configured = import.meta.env.VITE_LONGXIA_DEV_ORIGIN?.trim()
    if (configured) {
      const dev = configured.replace(/\/$/, '')
      return `${dev}/`
    }
    if (typeof window !== 'undefined') {
      try {
        const u = new URL(window.location.origin)
        u.port = '5175'
        return `${u.origin}/`
      } catch {
        /* fall through */
      }
    }
    return 'http://localhost:5175/'
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/longxia/`
  }
  return '/longxia/'
}
