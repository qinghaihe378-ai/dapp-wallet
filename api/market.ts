import { Redis } from 'ioredis'
import { fetchMarketsWithFallback, groupByChain, type ChainId, type MarketItem } from '../src/api/markets.js'

const redis = new Redis(process.env.REDIS_URL as string)
const TTL_SECONDS = 60

const CHAINS: ChainId[] = ['eth', 'base', 'bsc', 'sol']

function keyFor(chain: ChainId) {
  return `clawdex:markets:${chain}`
}

type MarketPayload = {
  updatedAt: number
  provider: string
  chain: ChainId | 'all'
  items: MarketItem[]
}

export default async function handler(req: any, res: any) {
  try {
    const chainParam = String(req?.query?.chain ?? 'all') as ChainId | 'all'
    const refresh = String(req?.query?.refresh ?? '') === '1'
    const chain = chainParam === 'all' ? 'all' : (CHAINS.includes(chainParam) ? chainParam : 'all')

    if (!refresh) {
      if (chain !== 'all') {
        const cached = await redis.get(keyFor(chain))
        if (cached) {
          res.status(200).json(JSON.parse(cached))
          return
        }
      } else {
        const keys = CHAINS.map((c) => keyFor(c))
        const cachedAll = await redis.mget(keys)
        const allItems: MarketItem[] = []
        let provider = 'Redis'
        let updatedAt = Date.now()
        let okCount = 0
        for (let i = 0; i < cachedAll.length; i++) {
          const raw = cachedAll[i]
          if (!raw) continue
          try {
            const payload = JSON.parse(raw) as MarketPayload
            if (payload?.items?.length) {
              okCount++
              provider = payload.provider || provider
              updatedAt = Math.max(updatedAt, payload.updatedAt || 0)
              allItems.push(...payload.items)
            }
          } catch {}
        }
        if (okCount === CHAINS.length) {
          res.status(200).json({ updatedAt, provider, chain: 'all', items: allItems } satisfies MarketPayload)
          return
        }
      }
    }

    // 缓存缺失或强制刷新：拉第三方行情，按链缓存各 50 个
    const { data, provider } = await fetchMarketsWithFallback(240, 1)
    const grouped = groupByChain(data)
    const now = Date.now()
    const writes: Array<Promise<unknown>> = []
    const byChain = new Map<ChainId, MarketItem[]>()
    for (const c of CHAINS) {
      const items = (grouped.get(c) ?? []).slice(0, 50)
      byChain.set(c, items)
      const payload: MarketPayload = { updatedAt: now, provider, chain: c, items }
      writes.push(redis.set(keyFor(c), JSON.stringify(payload), 'EX', TTL_SECONDS))
    }
    await Promise.allSettled(writes)

    if (chain === 'all') {
      const items = CHAINS.flatMap((c) => byChain.get(c) ?? [])
      res.status(200).json({ updatedAt: now, provider, chain: 'all', items } satisfies MarketPayload)
      return
    }

    res.status(200).json({ updatedAt: now, provider, chain, items: byChain.get(chain) ?? [] } satisfies MarketPayload)
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

