import { Redis } from 'ioredis'
import {
  dexMarketIdToTokenAddress,
  fetchOnchainMarketsWithFallback,
  groupByChain,
  type ChainId,
  type MarketItem,
} from '../src/api/markets.js'

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
    const nameRaw = String(obj.name ?? '').trim()
    /** 与后台表单一致：未填名称时用 symbol，避免 Redis 有数据但行情合并丢弃 */
    const name = nameRaw || symbol
    const image = String(obj.image ?? '').trim()
    const chain = String(obj.chain ?? '').trim().toLowerCase() as ChainId
    if (!id || !symbol || !image || !CHAINS.includes(chain)) continue
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

/** id 前缀 → 与手动配置 chain 一致的 ChainId（Dex 常用 ethereum: 地址） */
function idPrefixToChain(prefix: string): ChainId | null {
  const p = prefix.trim().toLowerCase()
  if (p === 'eth' || p === 'ethereum' || p === 'mainnet') return 'eth'
  if (p === 'bsc' || p === 'bnb' || p === 'binance') return 'bsc'
  if (p === 'base') return 'base'
  if (p === 'polygon' || p === 'matic' || p === 'polygon_pos') return 'polygon'
  return null
}

/**
 * 链 + 合约小写，用于对齐「eth:」与「ethereum:」等不同 id 写法。
 */
function canonicalMergeKey(id: string, fallbackChain?: ChainId): string | null {
  const addr = dexMarketIdToTokenAddress(id)
  if (!addr.startsWith('0x') || addr.length !== 42) return null
  const colon = id.indexOf(':')
  let chain: ChainId | null = colon > 0 ? idPrefixToChain(id.slice(0, colon)) : null
  if (!chain && fallbackChain && CHAINS.includes(fallbackChain)) {
    chain = fallbackChain
  }
  if (!chain || !CHAINS.includes(chain)) return null
  return `${chain}:${addr}`
}

function indexItemsByCanonicalKey(items: MarketItem[]) {
  const byCk = new Map<string, MarketItem>()
  const unindexed = new Map<string, MarketItem>()
  for (const item of items) {
    const ck = canonicalMergeKey(item.id)
    if (ck) {
      const prev = byCk.get(ck)
      if (!prev || (item.market_cap ?? 0) > (prev.market_cap ?? 0)) {
        byCk.set(ck, item)
      }
    } else {
      unindexed.set(item.id, item)
    }
  }
  return { byCk, unindexed }
}

/**
 * 合并手动热门：同一代币（链+合约）排在前面；价/涨跌/市值以链上缓存为准。
 * 用手动项覆盖头像/名称/符号。Dex id 常为 ethereum:0x…，后台常为 eth:0x…，故按 canonical key 匹配。
 * 若缓存中尚无该代币，则整段用手动配置（含后台静态价兜底）。
 */
function mergeManualItems(items: MarketItem[], manualItems: MarketItem[]) {
  if (manualItems.length === 0) return items
  const { byCk, unindexed } = indexItemsByCanonicalKey(items)
  const head: MarketItem[] = []
  for (const m of manualItems) {
    const ck = canonicalMergeKey(m.id, m.chain)
    let base = ck ? byCk.get(ck) : undefined
    if (!base) base = unindexed.get(m.id)
    if (base) {
      head.push({
        ...base,
        image: m.image?.trim() ? m.image : base.image,
        name: m.name?.trim() ? m.name : base.name,
        symbol: m.symbol?.trim() ? m.symbol : base.symbol,
      })
      if (ck) byCk.delete(ck)
      unindexed.delete(base.id)
    } else {
      head.push(m)
    }
  }
  return [...head, ...byCk.values(), ...unindexed.values()]
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

