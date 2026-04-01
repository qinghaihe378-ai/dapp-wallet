/** Boot 本地持久化键 */

export const STORAGE_KEYS = {
  tasks: 'clawdex:boot:tasks',
  risk: 'clawdex:boot:risk',
  copy: 'clawdex:boot:copy',
  session: 'clawdex:boot:session',
} as const

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota
  }
}
