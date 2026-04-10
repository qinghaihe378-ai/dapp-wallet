export type PageId = 'home' | 'market' | 'newTokens' | 'bot' | 'swap'

export type SectionConfig = {
  id: string
  enabled: boolean
  order: number
  props?: Record<string, unknown>
}

export type PageConfig = {
  title?: string
  subtitle?: string
  notice?: string
  sections?: SectionConfig[]
  manualHotTokens?: Array<{
    id: string
    symbol: string
    name: string
    image: string
    current_price: number
    price_change_percentage_24h: number | null
    market_cap: number
    chain: 'eth' | 'bsc' | 'base' | 'polygon'
  }>
  updatedAt?: number
}

async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = data?.message ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export async function adminLogin(password: string) {
  return await jsonFetch<{ ok: boolean }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function adminLogout() {
  return await jsonFetch<{ ok: boolean }>('/api/admin/logout', { method: 'POST' })
}

export async function getAdminPageConfig(page: PageId) {
  return await jsonFetch<{ ok: boolean; page: string; config: PageConfig | null }>(`/api/admin/config?page=${encodeURIComponent(page)}`)
}

export async function setAdminPageConfig(page: PageId, config: PageConfig) {
  return await jsonFetch<{ ok: boolean; page: string; config: PageConfig }>(`/api/admin/config?page=${encodeURIComponent(page)}`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  })
}

export async function getPublicPageConfig(page: PageId) {
  return await jsonFetch<{ ok: boolean; page: string; config: PageConfig | null }>(`/api/public-config?page=${encodeURIComponent(page)}`)
}

