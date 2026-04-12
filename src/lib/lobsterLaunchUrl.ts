/**
 * 龙虾发射独立部署地址（最安全：不合并代码，仅外链）。
 * 仅接受 http(s)，避免误配 javascript: 等。
 */
export function getLobsterLaunchUrl(): string | undefined {
  const raw = import.meta.env.VITE_LOBSTER_LAUNCH_URL
  if (raw == null || typeof raw !== 'string') return undefined
  const t = raw.trim()
  if (!t) return undefined
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    return u.href
  } catch {
    return undefined
  }
}
