import { redis } from './_redis.js'

const CACHE_KEY = 'clawdex:topTicker:v1'
const CACHE_TTL_SEC = 6

type TickerRow = {
  label: '龙虾' | 'BTC' | 'ETH' | 'BNB'
  price: number | null
  change: number | null
}

async function fetchBinance24h() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
    { headers: { Accept: 'application/json', 'User-Agent': 'clawdex-top-ticker' } },
  )
  if (!res.ok) throw new Error(`Binance ticker HTTP ${res.status}`)
  const json = (await res.json()) as Array<{ symbol?: string; lastPrice?: string; priceChangePercent?: string }>
  const map = new Map<string, { price: number | null; change: number | null }>()
  for (const row of Array.isArray(json) ? json : []) {
    const symbol = String(row?.symbol ?? '').toUpperCase()
    const priceNum = Number(row?.lastPrice ?? 0)
    const changeNum = Number(row?.priceChangePercent ?? 0)
    map.set(symbol, {
      price: Number.isFinite(priceNum) ? priceNum : null,
      change: Number.isFinite(changeNum) ? changeNum : null,
    })
  }
  return map
}

async function readLobsterFromRedis() {
  const keys = ['clawdex:markets:eth', 'clawdex:markets:bsc', 'clawdex:markets:base', 'clawdex:markets:polygon']
  const raws = await redis.mget(keys)
  for (const raw of raws) {
    if (!raw) continue
    try {
      const payload = JSON.parse(raw) as { items?: Array<{ symbol?: string; name?: string; current_price?: number; price_change_percentage_24h?: number | null }> }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const hit = items.find((it) => {
        const s = String(it?.symbol ?? '').toLowerCase()
        const n = String(it?.name ?? '').toLowerCase()
        return s === 'lobster' || s === 'longxia' || s === 'lx' || n.includes('lobster') || n.includes('龙虾')
      })
      if (hit) {
        const p = Number(hit.current_price ?? 0)
        const c = hit.price_change_percentage_24h == null ? null : Number(hit.price_change_percentage_24h)
        return {
          price: Number.isFinite(p) ? p : null,
          change: c == null || Number.isFinite(c) ? c : null,
        }
      }
    } catch {
      // ignore bad cache
    }
  }
  return { price: null, change: null }
}

export default async function handler(_req: any, res: any) {
  try {
    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      const payload = JSON.parse(cached)
      res.status(200).json(payload)
      return
    }

    const [binance, lobster] = await Promise.all([fetchBinance24h(), readLobsterFromRedis()])
    const items: TickerRow[] = [
      { label: '龙虾', price: lobster.price, change: lobster.change },
      { label: 'BTC', price: binance.get('BTCUSDT')?.price ?? null, change: binance.get('BTCUSDT')?.change ?? null },
      { label: 'ETH', price: binance.get('ETHUSDT')?.price ?? null, change: binance.get('ETHUSDT')?.change ?? null },
      { label: 'BNB', price: binance.get('BNBUSDT')?.price ?? null, change: binance.get('BNBUSDT')?.change ?? null },
    ]
    const payload = { ok: true, updatedAt: Date.now(), items }
    await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SEC)
    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
