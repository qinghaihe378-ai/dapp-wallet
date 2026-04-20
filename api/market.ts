import { Redis } from 'ioredis'
import {
  dexMarketIdToTokenAddress,
  fetchOnchainMarketsWithFallback,
  groupByChain,
  searchByAddressOrQuery,
  type ChainId,
  type MarketItem,
} from '../src/api/markets.js'

const redis = new Redis(process.env.REDIS_URL as string)
// 让前端 10 秒轮询真正生效：缓存只保留短时间
const DEFAULT_TTL_SECONDS = 12
const DEFAULT_FRESH_MS = 10_000
const ALPHA_CACHE_KEY = 'clawdex:markets:alpha'

const CHAINS: ChainId[] = ['eth', 'base', 'bsc', 'polygon']
const HOME_PAGE_CONFIG_KEY = 'clawdex:pageConfig:home'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const TOKEN_LIBRARY_KEY = 'clawdex:tokenLibrary'
/** 手动热门未进榜单时，Dex 单价缓存（秒），多客户端共用，减轻 DexScreener 压力 */
const MANUAL_SPOT_TTL_SEC = 20
const REAL_ONCHAIN_ONLY = true

function manualSpotRedisKey(ck: string) {
  return `clawdex:manualHotSpot:${ck}`
}

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
  const baseFromConfig = !raw
    ? []
    : (() => {
        try {
          const cfg = JSON.parse(raw) as { manualHotTokens?: unknown }
          return normalizeManualHotTokens(cfg?.manualHotTokens)
        } catch {
          return []
        }
      })()
  const baseFromLibrary = await getHotTokensFromLibrary()
  const merged = [...baseFromConfig, ...baseFromLibrary]
  const byId = new Map<string, MarketItem>()
  for (const item of merged) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

async function getHotTokensFromLibrary(): Promise<MarketItem[]> {
  const raw = await redis.get(TOKEN_LIBRARY_KEY)
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as Array<Record<string, unknown>>
    const mapped = (Array.isArray(list) ? list : [])
      .filter((it) => Boolean(it?.hot) && it?.enabled !== false)
      .map((it) => ({
        id: String(it.id ?? '').trim(),
        symbol: String(it.symbol ?? '').trim(),
        name: String(it.name ?? '').trim() || String(it.symbol ?? '').trim(),
        image: String(it.image ?? '').trim(),
        current_price: Number(it.current_price ?? 0) || 0,
        price_change_percentage_24h:
          it.price_change_percentage_24h == null || it.price_change_percentage_24h === ''
            ? null
            : Number(it.price_change_percentage_24h),
        market_cap: Number(it.market_cap ?? 0) || 0,
        chain: String(it.chain ?? '').trim().toLowerCase() as ChainId,
      }))
      .filter((it) => it.id && it.symbol && it.image && CHAINS.includes(it.chain))
    return mapped.sort((a, b) => Number((a as any).rank ?? 0) - Number((b as any).rank ?? 0))
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

/** 与详情页同源：按合约拉 DexScreener，带 Redis 短缓存 */
async function dexSpotForManual(m: MarketItem): Promise<MarketItem | null> {
  const ck = canonicalMergeKey(m.id, m.chain)
  if (!ck) return null
  const addr = dexMarketIdToTokenAddress(m.id)
  if (!addr.startsWith('0x') || addr.length !== 42) return null
  const cacheKey = manualSpotRedisKey(ck)
  try {
    const raw = await redis.get(cacheKey)
    if (raw) {
      const parsed = JSON.parse(raw) as MarketItem
      if (parsed && typeof parsed.current_price === 'number') return parsed
    }
  } catch {
    /* ignore */
  }
  try {
    const rows = await searchByAddressOrQuery(addr, { allowZeroPrice: true })
    const hit =
      rows.find((it) => it.chain === m.chain && dexMarketIdToTokenAddress(it.id) === addr) ??
      rows.find((it) => dexMarketIdToTokenAddress(it.id) === addr)
    if (hit) {
      await redis.set(cacheKey, JSON.stringify(hit), 'EX', MANUAL_SPOT_TTL_SEC)
      return hit
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 手动热门前几项与 manualSlice 一一对应。未命中链上榜单的项用 Dex 现价覆盖（与详情页一致）。
 */
async function enrichManualOnlyPrices(
  merged: MarketItem[],
  manualSlice: MarketItem[],
  allCachedItems: MarketItem[],
): Promise<MarketItem[]> {
  if (manualSlice.length === 0) return merged
  const { byCk, unindexed } = indexItemsByCanonicalKey(allCachedItems)
  const missIndices: number[] = []
  for (let i = 0; i < manualSlice.length; i++) {
    const m = manualSlice[i]
    const ck = canonicalMergeKey(m.id, m.chain)
    let base = ck ? byCk.get(ck) : undefined
    if (!base) base = unindexed.get(m.id)
    if (!base) missIndices.push(i)
  }
  if (missIndices.length === 0) return merged

  const out = [...merged]
  await Promise.all(
    missIndices.map(async (i) => {
      const m = manualSlice[i]
      const live = await dexSpotForManual(m)
      if (!live || i >= out.length) return
      out[i] = {
        ...live,
        image: m.image?.trim() ? m.image : live.image,
        name: m.name?.trim() ? m.name : live.name,
        symbol: m.symbol?.trim() ? m.symbol : live.symbol,
      }
    }),
  )
  return out
}

function sendMarketPayload(res: any, payload: MarketPayload) {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.status(200).json(payload)
}

function normalizeRealOnchainItems(items: MarketItem[]): MarketItem[] {
  const byCk = new Map<string, MarketItem>()
  for (const item of items) {
    const ck = canonicalMergeKey(item.id, item.chain)
    if (!ck) continue
    if (!Number.isFinite(item.current_price) || item.current_price <= 0) continue
    const prev = byCk.get(ck)
    if (!prev || (item.market_cap ?? 0) > (prev.market_cap ?? 0)) {
      const chain = ck.slice(0, ck.indexOf(':')) as ChainId
      byCk.set(ck, { ...item, id: ck, chain })
    }
  }
  return [...byCk.values()].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
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

type SystemConfig = {
  market?: {
    cacheTtlSeconds?: number
    freshMs?: number
    enableAlpha?: boolean
    retries?: number
    sourceToggles?: {
      dexScreener?: boolean
      birdeye?: boolean
      coinGecko?: boolean
      coinPaprika?: boolean
      coinCap?: boolean
    }
  }
  apiKeys?: {
    birdeyeApiKey?: string
  }
}

async function getSystemConfig(): Promise<SystemConfig> {
  try {
    const raw = await redis.get(SYSTEM_CONFIG_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SystemConfig
    return parsed ?? {}
  } catch {
    return {}
  }
}

type BinanceAlphaToken = {
  tokenId?: string
  alphaId?: string
  chainId?: string
  contractAddress?: string
  name?: string
  symbol?: string
  iconUrl?: string
  logoUrl?: string
  tokenIconUrl?: string
  chainIconUrl?: string
  price?: string
  percentChange24h?: string
  volume24h?: string
  marketCap?: string
}

function alphaChainToInternal(chainId: string | undefined): ChainId | null {
  if (chainId === '1') return 'eth'
  if (chainId === '56') return 'bsc'
  if (chainId === '8453') return 'base'
  if (chainId === '137') return 'polygon'
  return null
}

async function fetchBinanceAlphaMarkets(limit = 250): Promise<MarketItem[]> {
  const res = await fetch(
    'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'clawdex-market-fetcher',
      },
    },
  )
  if (!res.ok) throw new Error(`Binance Alpha HTTP ${res.status}`)
  const json = (await res.json()) as { code?: string; success?: boolean; data?: BinanceAlphaToken[] }
  if (!json?.success || json.code !== '000000' || !Array.isArray(json.data)) {
    throw new Error('Binance Alpha 响应格式异常')
  }
  const out: MarketItem[] = []
  for (const token of json.data) {
    const chain = alphaChainToInternal(token.chainId)
    const address = String(token.contractAddress ?? '').trim().toLowerCase()
    if (!chain || !address.startsWith('0x') || address.length !== 42) continue
    const symbol = String(token.symbol ?? '').trim()
    const name = String(token.name ?? '').trim() || symbol
    if (!symbol || !name) continue
    const price = Number(token.price ?? 0)
    if (!Number.isFinite(price) || price <= 0) continue
    const marketCap = Number(token.marketCap ?? 0)
    const volume24h = Number(token.volume24h ?? 0)
    const p24 = Number(token.percentChange24h ?? 0)
    const icon =
      String(token.iconUrl ?? '').trim() ||
      String(token.tokenIconUrl ?? '').trim() ||
      String(token.logoUrl ?? '').trim() ||
      String(token.chainIconUrl ?? '').trim()
    out.push({
      id: `${chain}:${address}`,
      symbol,
      name,
      image: icon,
      current_price: price,
      price_change_percentage_24h: Number.isFinite(p24) ? p24 : null,
      market_cap: Number.isFinite(marketCap) ? marketCap : 0,
      volume_24h: Number.isFinite(volume24h) ? volume24h : 0,
      chain,
      coingeckoId: undefined,
    })
  }
  // Alpha 少量代币会缺 iconUrl，回退到 Dex 按合约自动补头像
  const missingImage = out.filter((it) => !it.image).slice(0, 120)
  await Promise.all(
    missingImage.map(async (it) => {
      try {
        const addr = dexMarketIdToTokenAddress(it.id)
        if (!addr.startsWith('0x')) return
        const rows = await searchByAddressOrQuery(addr, { allowZeroPrice: true })
        const hit =
          rows.find((x) => x.chain === it.chain && dexMarketIdToTokenAddress(x.id) === addr) ??
          rows.find((x) => dexMarketIdToTokenAddress(x.id) === addr)
        if (hit?.image) it.image = hit.image
      } catch {
        // ignore single token fallback error
      }
    }),
  )
  return out
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    .slice(0, limit)
}

export default async function handler(req: any, res: any) {
  try {
    const sysCfg = await getSystemConfig()
    const ttlSeconds = Math.max(1, Number(sysCfg.market?.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS))
    const freshMs = Math.max(500, Number(sysCfg.market?.freshMs ?? DEFAULT_FRESH_MS))
    const alphaEnabled = sysCfg.market?.enableAlpha !== false
    const chainParam = String(req?.query?.chain ?? 'all') as ChainId | 'all'
    const scope = String(req?.query?.scope ?? '').trim().toLowerCase()
    const refresh = String(req?.query?.refresh ?? '') === '1'
    const chain = chainParam === 'all' ? 'all' : (CHAINS.includes(chainParam) ? chainParam : 'all')

    if (scope === 'alpha') {
      if (!alphaEnabled) {
        res.status(403).json({ ok: false, message: 'alpha source disabled by admin config' })
        return
      }
      if (!refresh) {
        const cached = await redis.get(ALPHA_CACHE_KEY)
        if (cached) {
          const payload = JSON.parse(cached) as MarketPayload
            const age = Date.now() - (payload.updatedAt || 0)
            if (age >= 0 && age < freshMs) {
            const byChain = chain === 'all' ? payload.items : payload.items.filter((it) => it.chain === chain)
            sendMarketPayload(res, { ...payload, chain, items: byChain } satisfies MarketPayload)
            return
          }
        }
      }
      const now = Date.now()
      const alphaItems = await fetchBinanceAlphaMarkets(250)
      const alphaPayload: MarketPayload = {
        updatedAt: now,
        provider: 'BinanceAlpha',
        chain: 'all',
        items: alphaItems,
      }
      await redis.set(ALPHA_CACHE_KEY, JSON.stringify(alphaPayload), 'EX', ttlSeconds)
      const normalized = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(alphaItems) : alphaItems
      const byChain = chain === 'all' ? normalized : normalized.filter((it) => it.chain === chain)
      sendMarketPayload(res, { ...alphaPayload, chain, items: byChain } satisfies MarketPayload)
      return
    }

    if (!refresh) {
      if (chain !== 'all') {
        const cached = await redis.get(keyFor(chain))
        if (cached) {
          const payload = JSON.parse(cached) as MarketPayload
          const age = Date.now() - (payload.updatedAt || 0)
          if (age >= 0 && age < freshMs) {
            const realItems = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(payload.items ?? []) : (payload.items ?? [])
            sendMarketPayload(res, { ...payload, items: realItems })
            return
          }
        }
      } else {
        const { okCount, provider, updatedAt, allItems } = await readCachedAll()
        const age = Date.now() - (updatedAt || 0)
        if (okCount === CHAINS.length && age >= 0 && age < freshMs) {
          const realItems = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(allItems) : allItems
          sendMarketPayload(res, { updatedAt, provider, chain: 'all', items: realItems } satisfies MarketPayload)
          return
        }
      }
    }

    // 缓存缺失或强制刷新：优先拉链上 Dex 行情，按链缓存各 N 个
    try {
      const effectiveToggles = REAL_ONCHAIN_ONLY
        ? {
            ...(sysCfg.market?.sourceToggles ?? {}),
            coinGecko: false,
            coinPaprika: false,
            coinCap: false,
          }
        : sysCfg.market?.sourceToggles
      const { data, provider } = await fetchOnchainMarketsWithFallback(800, 1, {
        retries: Math.max(1, Number(sysCfg.market?.retries ?? 1)),
        sourceToggles: effectiveToggles,
        birdeyeApiKey: String(sysCfg.apiKeys?.birdeyeApiKey ?? '').trim() || undefined,
      })
      const grouped = groupByChain(data)
      const now = Date.now()
      const writes: Array<Promise<unknown>> = []
      const byChain = new Map<ChainId, MarketItem[]>()
      for (const c of CHAINS) {
        const items = (REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(grouped.get(c) ?? []) : (grouped.get(c) ?? [])).slice(0, 250)
        byChain.set(c, items)
        const payload: MarketPayload = { updatedAt: now, provider, chain: c, items }
        writes.push(redis.set(keyFor(c), JSON.stringify(payload), 'EX', ttlSeconds))
      }
      await Promise.allSettled(writes)

      if (chain === 'all') {
        const flat = CHAINS.flatMap((c) => byChain.get(c) ?? [])
        const items = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(flat) : flat
        sendMarketPayload(res, { updatedAt: now, provider, chain: 'all', items } satisfies MarketPayload)
        return
      }

      const chainList = byChain.get(chain) ?? []
      const chainItems = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(chainList) : chainList
      sendMarketPayload(res, { updatedAt: now, provider, chain, items: chainItems } satisfies MarketPayload)
    } catch (e) {
      // 第三方 API 失败：尽量返回 Redis 里的旧缓存，不让前端一直报“加载失败”
      if (chain === 'all') {
        const { okCount, provider, updatedAt, allItems } = await readCachedAll()
        if (okCount > 0) {
          const items = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(allItems) : allItems
          sendMarketPayload(res, {
            updatedAt,
            provider: `${provider} (stale)`,
            chain: 'all',
            items,
          } satisfies MarketPayload)
          return
        }
      } else {
        const cached = await redis.get(keyFor(chain))
        if (cached) {
          const payload = JSON.parse(cached) as MarketPayload
          const cachedList = payload.items ?? []
          const merged = REAL_ONCHAIN_ONLY ? normalizeRealOnchainItems(cachedList) : cachedList
          sendMarketPayload(res, {
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
