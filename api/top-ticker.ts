import { redis } from './_redis.js'
import { dexMarketIdToTokenAddress, searchByAddressOrQuery, type ChainId, type MarketItem } from '../src/api/markets.js'

const CACHE_KEY = 'clawdex:topTicker:v1'
const CACHE_TTL_SEC = 6

type TickerRow = {
  label: '龙虾' | 'BTCB' | 'ETH' | 'WBNB'
  price: number | null
  change: number | null
}

const TOKEN_ADDRESS = {
  BTCB: '0x7130d2a12b9bcBfae4f2634d864a1ee1ce3ead9c',
  ETH: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
} as const

async function readLobsterFromRedis() {
  const keys = ['clawdex:markets:eth', 'clawdex:markets:bsc', 'clawdex:markets:base', 'clawdex:markets:polygon']
  const raws = await redis.mget(keys)
  for (const raw of raws) {
    if (!raw) continue
    try {
      const payload = JSON.parse(raw) as { items?: Array<{ id?: string; symbol?: string; name?: string; current_price?: number; price_change_percentage_24h?: number | null }> }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const hit = items.find((it) => {
        const s = String(it?.symbol ?? '').toLowerCase()
        const n = String(it?.name ?? '').toLowerCase()
        return s === 'lobster' || s === 'longxia' || s === 'lx' || n.includes('lobster') || n.includes('龙虾')
      })
      if (hit) {
        const addr = dexMarketIdToTokenAddress(String(hit.id ?? ''))
        const p = Number(hit.current_price ?? 0)
        const c = hit.price_change_percentage_24h == null ? null : Number(hit.price_change_percentage_24h)
        return {
          id: String(hit.id ?? ''),
          address: addr.startsWith('0x') ? addr : '',
          price: Number.isFinite(p) ? p : null,
          change: c == null || Number.isFinite(c) ? c : null,
        }
      }
    } catch {
      // ignore bad cache
    }
  }
  return { id: '', address: '', price: null, change: null }
}

function pickBest(rows: MarketItem[], preferChain?: ChainId): MarketItem | null {
  if (!rows.length) return null
  const scoped = preferChain ? rows.filter((r) => r.chain === preferChain) : rows
  const use = scoped.length ? scoped : rows
  return [...use].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))[0] ?? null
}

async function readOnchainByAddress(address: string, preferChain?: ChainId) {
  const rows = await searchByAddressOrQuery(address, { allowZeroPrice: true })
  const hit = pickBest(rows, preferChain)
  if (!hit) return { price: null, change: null }
  return {
    price: Number.isFinite(hit.current_price) ? hit.current_price : null,
    change: hit.price_change_percentage_24h ?? null,
  }
}

export default async function handler(_req: any, res: any) {
  try {
    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      const payload = JSON.parse(cached)
      res.status(200).json(payload)
      return
    }

    const lobsterSeed = await readLobsterFromRedis()
    const [btcb, eth, wbnb, lobsterOnchain] = await Promise.all([
      readOnchainByAddress(TOKEN_ADDRESS.BTCB, 'bsc'),
      readOnchainByAddress(TOKEN_ADDRESS.ETH, 'bsc'),
      readOnchainByAddress(TOKEN_ADDRESS.WBNB, 'bsc'),
      lobsterSeed.address ? readOnchainByAddress(lobsterSeed.address) : Promise.resolve({ price: null, change: null }),
    ])
    const items: TickerRow[] = [
      { label: '龙虾', price: lobsterOnchain.price ?? lobsterSeed.price, change: lobsterOnchain.change ?? lobsterSeed.change },
      { label: 'BTCB', price: btcb.price, change: btcb.change },
      { label: 'ETH', price: eth.price, change: eth.change },
      { label: 'WBNB', price: wbnb.price, change: wbnb.change },
    ]
    const payload = { ok: true, updatedAt: Date.now(), items }
    await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SEC)
    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
