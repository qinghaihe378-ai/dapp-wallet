import { requireAdmin } from '../_auth.js'
import { getJson, setJson } from '../_redis.js'

const TOKEN_LIBRARY_KEY = 'clawdex:tokenLibrary'

function normalizeItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((it) => it && typeof it === 'object')
    .map((it) => {
      const o = it as Record<string, unknown>
      const id = String(o.id ?? '').trim()
      const symbol = String(o.symbol ?? '').trim()
      const name = String(o.name ?? '').trim() || symbol
      const image = String(o.image ?? '').trim()
      const chain = String(o.chain ?? '').trim().toLowerCase()
      const address = String(o.address ?? '').trim()
      return {
        id,
        symbol,
        name,
        image,
        chain,
        address,
        current_price: Number(o.current_price ?? 0) || 0,
        market_cap: Number(o.market_cap ?? 0) || 0,
        price_change_percentage_24h:
          o.price_change_percentage_24h == null || o.price_change_percentage_24h === ''
            ? null
            : Number(o.price_change_percentage_24h),
        enabled: o.enabled !== false,
        hot: Boolean(o.hot ?? false),
        rank: Number(o.rank ?? 0) || 0,
      }
    })
    .filter((it) => it.id && it.symbol && it.chain && it.image)
}

export default async function handler(req: any, res: any) {
  try {
    requireAdmin(req)
    const method = String(req?.method ?? 'GET').toUpperCase()

    if (method === 'GET') {
      const items = (await getJson<any[]>(TOKEN_LIBRARY_KEY)) ?? []
      res.status(200).json({ ok: true, items, updatedAt: Date.now() })
      return
    }

    if (method === 'PUT' || method === 'POST') {
      const body = typeof req?.body === 'string' ? JSON.parse(req.body) : (req?.body ?? {})
      const items = normalizeItems(body?.items)
      await setJson(TOKEN_LIBRARY_KEY, items)
      res.status(200).json({ ok: true, items, updatedAt: Date.now() })
      return
    }

    res.status(405).json({ ok: false, message: 'Method Not Allowed' })
  } catch (e) {
    const status = (e as any)?.statusCode
    if (status === 401) {
      res.status(401).json({ ok: false, message: 'unauthorized' })
      return
    }
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
