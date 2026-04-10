import { Redis } from 'ioredis'
import { fetchOnchainMarketsWithFallback, groupByChain, type ChainId, type MarketItem } from '../src/api/markets.js'

const redis = new Redis(process.env.REDIS_URL as string)
// 让前端 10 秒轮询真正生效：缓存只保留短时间
const TTL_SECONDS = 12
const FRESH_MS = 10_000

const CHAINS: ChainId[] = ['eth', 'base', 'bsc', 'polygon']
const HOME_PAGE_CONFIG_KEY = 'clawdex:pageConfig:home'

function keyFor(chain: ChainId) {
  return `clawdex:markets:${chain}`
}

function normalizeManualHotTokens(raw: unknown): MarketItem[] {
  if (!Array.isArray(raw)) return []
  const out: MarketItem[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const obj = it as Record<string, unknown>
    const id = String(obj.id ?? '').trim()
    const symbol = String(obj.symbol ?? '').trim()
    const name = String(obj.name ?? '').trim()
    const image = String(obj.image ?? '').trim()
    const chain = String(obj.chain ?? '').trim().toLowerCase() as ChainId
    if (!id || !symbol || !name || !image || !CHAINS.includes(chain)) continue
    const current_price = Number(obj.current_price ?? 0)
    const market_cap = Number(obj.market_cap ?? 0)
    const p24raw = obj.price_change_percentage_24h
    const price_change_percentage_24h =
      p24raw == null || p24raw === '' ? null : Number(p24raw)
    out.push({
      id,
      symbol,
      name,
      image,
      chain,
      current_price: Number.isFinite(current_price) ? current_price : 0,
      price_change_percentage_24h:
        price_change_percentage_24h == null || Number.isFinite(price_change_percentage_24h)
          ? price_change_percentage_24h
          : null,
      market_cap: Number.isFinite(market_cap) ? market_cap : 0,
      coingeckoId: undefined,
    })
  }
  return out
}

async function getManualHotTokens(): Promise<MarketItem[]> {
  const raw = await redis.get(HOME_PAGE_CONFIG_KEY)
  if (!raw) return []
  try {
    const cfg = JSON.parse(raw) as { manualHotTokens?: unknown }
    return normalizeManualHotTokens(cfg?.manualHotTokens)
  } catch {
    return []
  }
}

/** 合并手动热门：同 id 以手动为准；手动项排在前面，便于首页露出 */
function mergeManualItems(items: MarketItem[], manualItems: MarketItem[]) {
  if (manualItems.length === 0) return items
  const byId = new Map<string, MarketItem>()
  for (const item of items) byId.set(item.id, item)
  const head: MarketItem[] = []
  for (const m of manualItems) {
    const base = byId.get(m.id)
    head.push(base ? { ...base, ...m } : m)
    byId.delete(m.id)
  }
  return [...head, ...byId.values()]
}

async function readCachedAll() {
  const keys = CHAINS.map((c) => keyFor(c))
  const cachedAll = await redis.mget(keys)
  const allItems: MarketItem[] = []
  let provider = 'Redis'
  let updatedAt = 0
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
  return { okCount, provider, updatedAt, allItems }
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
      const manualItems = await getManualHotTokens()
      if (chain !== 'all') {
        const cached = await redis.get(keyFor(chain))
        if (cached) {
          const payload = JSON.parse(cached) as MarketPayload
          const age = Date.now() - (payload.updatedAt || 0)
          if (age >= 0 && age < FRESH_MS) {
            const merged = mergeManualItems(payload.items ?? [], manualItems.filter((x) => x.chain === chain))
            res.status(200).json({ ...payload, items: merged })
            return
          }
        }
      } else {
        const { okCount, provider, updatedAt, allItems } = await readCachedAll()
        const age = Date.now() - (updatedAt || 0)
        if (okCount === CHAINS.length && age >= 0 && age < FRESH_MS) {
          const merged = mergeManualItems(allItems, manualItems)
          res.status(200).json({ updatedAt, provider, chain: 'all', items: merged } satisfies MarketPayload)
          return
        }
      }
    }

    // 缓存缺失或强制刷新：优先拉链上 Dex 行情，按链缓存各 N 个
    try {
      const { data, provider } = await fetchOnchainMarketsWithFallback(800, 1)
      const grouped = groupByChain(data)
      const now = Date.now()
      const writes: Array<Promise<unknown>> = []
      const byChain = new Map<ChainId, MarketItem[]>()
      for (const c of CHAINS) {
        const items = (grouped.get(c) ?? []).slice(0, 250)
        byChain.set(c, items)
        const payload: MarketPayload = { updatedAt: now, provider, chain: c, items }
        writes.push(redis.set(keyFor(c), JSON.stringify(payload), 'EX', TTL_SECONDS))
      }
      await Promise.allSettled(writes)

      const manualItems = await getManualHotTokens()

      if (chain === 'all') {
        const items = mergeManualItems(CHAINS.flatMap((c) => byChain.get(c) ?? []), manualItems)
        res.status(200).json({ updatedAt: now, provider, chain: 'all', items } satisfies MarketPayload)
        return
      }

      const chainItems = mergeManualItems(byChain.get(chain) ?? [], manualItems.filter((x) => x.chain === chain))
      res.status(200).json({ updatedAt: now, provider, chain, items: chainItems } satisfies MarketPayload)
    } catch (e) {
      // 第三方 API 失败：尽量返回 Redis 里的旧缓存，不让前端一直报“加载失败”
      if (chain === 'all') {
        const { okCount, provider, updatedAt, allItems } = await readCachedAll()
        if (okCount > 0) {
          const manualItems = await getManualHotTokens()
          res.status(200).json({
            updatedAt,
            provider: `${provider} (stale)`,
            chain: 'all',
            items: mergeManualItems(allItems, manualItems),
          } satisfies MarketPayload)
          return
        }
      } else {
        const cached = await redis.get(keyFor(chain))
        if (cached) {
          const payload = JSON.parse(cached) as MarketPayload
          const manualItems = await getManualHotTokens()
          const merged = mergeManualItems(payload.items ?? [], manualItems.filter((x) => x.chain === chain))
          res.status(200).json({
            ...payload,
            provider: `${payload.provider} (stale)`,
            items: merged,
          } satisfies MarketPayload)
          return
        }
      }
      throw e
    }
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

