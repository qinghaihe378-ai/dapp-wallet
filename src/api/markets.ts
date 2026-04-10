import axios from 'axios'

/** 采集规则配置 */
export const COLLECTION_RULES = {
  /** 全链数据刷新间隔（毫秒） */
  intervalMs: 10_000,
  /** 每次采集数量 */
  perPage: 50,
  /** 静默刷新（不显示 loading） */
  silentRefresh: true,
} as const

/** 采集间隔，供页面使用 */
export const COLLECTION_INTERVAL_MS = COLLECTION_RULES.intervalMs

/** 公链标识，与 app 内 network 对应 */
export type ChainId = 'eth' | 'bsc' | 'polygon' | 'base' | 'avax' | 'btc' | 'other'

export interface MarketItem {
  id: string
  symbol: string
  name: string
  image: string
  current_price: number
  price_change_percentage_24h: number | null
  market_cap?: number
  chain: ChainId
  /** CoinGecko 兼容 id，用于详情页 */
  coingeckoId?: string
}

/** CoinGecko 返回格式 */
interface CoinGeckoItem {
  id: string
  symbol: string
  name: string
  image: string
  current_price: number
  price_change_percentage_24h: number | null
  market_cap?: number
}

/** CoinPaprika 返回格式 */
interface CoinPaprikaItem {
  id: string
  symbol: string
  name: string
  quotes: { USD: { price: number; percent_change_24h?: number; market_cap?: number } }
}

/** CoinCap 返回格式 */
interface CoinCapItem {
  id: string
  symbol: string
  name: string
  priceUsd: string
  changePercent24Hr?: string
  marketCapUsd?: string
}

/** Birdeye V3 token 返回格式 */
interface BirdeyeTokenItem {
  address: string
  logo_uri?: string
  name: string
  symbol: string
  market_cap?: number
  price?: number
  price_change_24h_percent?: number
  extensions?: { coingecko_id?: string }
}

/** DexScreener pair 返回格式 */
interface DexScreenerPair {
  chainId: string
  baseToken: { address: string; symbol: string; name: string }
  priceUsd?: string
  priceChange?: { h24?: number }
  marketCap?: number
  liquidity?: { usd?: number }
  info?: { imageUrl?: string }
}

/** 根据 coin id 推断所属公链 */
const CHAIN_MAP: Record<string, ChainId> = {
  bitcoin: 'btc',
  ethereum: 'eth',
  binancecoin: 'bsc',
  'bnb-binance-coin': 'bsc',
  solana: 'other',
  'matic-network': 'polygon',
  'matic-polygon': 'polygon',
  'avalanche-2': 'avax',
  'usd-coin': 'eth',
  'tether': 'eth',
  'dai': 'eth',
  'wrapped-bitcoin': 'eth',
  'usdt-tether': 'eth',
  'eth-ethereum': 'eth',
  'btc-bitcoin': 'btc',
  'sol-solana': 'other',
  'xrp-xrp': 'other',
  'ada-cardano': 'other',
  'doge-dogecoin': 'other',
}

/** CoinPaprika/CoinCap id -> CoinGecko id，用于详情页 */
const COINGECKO_ID_MAP: Record<string, string> = {
  'btc-bitcoin': 'bitcoin',
  'eth-ethereum': 'ethereum',
  'bnb-binance-coin': 'binancecoin',
  'sol-solana': 'solana',
  'usdt-tether': 'tether',
  'xrp-xrp': 'ripple',
  'ada-cardano': 'cardano',
  'doge-dogecoin': 'dogecoin',
}

function getChain(coinId: string, symbol: string): ChainId {
  const lower = coinId.toLowerCase()
  if (CHAIN_MAP[lower]) return CHAIN_MAP[lower]
  const sym = symbol.toUpperCase()
  if (sym === 'SOL') return 'other'
  if (sym === 'BNB') return 'bsc'
  if (sym === 'MATIC') return 'polygon'
  if (sym === 'AVAX') return 'avax'
  if (sym === 'ETH' || sym === 'WETH') return 'eth'
  if (sym === 'BTC') return 'btc'
  return 'other'
}

/** DexScreener chainId -> 我们的 ChainId */
const DEXSCREENER_CHAIN_MAP: Record<string, ChainId> = {
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
  polygon: 'polygon',
  polygon_pos: 'polygon',
  arbitrum: 'eth',
  avalanche: 'avax',
  optimism: 'eth',
}

/** API 配置：多个端点，自动切换 */
const MARKET_APIS = [
  {
    name: 'CoinGecko',
    fetch: async (perPage: number, page: number): Promise<MarketItem[]> => {
      const res = await axios.get<CoinGeckoItem[]>(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: perPage,
            page,
            price_change_percentage: '24h',
          },
          timeout: 10000,
        },
      )
      return res.data.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        image: item.image,
        current_price: item.current_price,
        price_change_percentage_24h: item.price_change_percentage_24h,
        market_cap: item.market_cap,
        chain: getChain(item.id, item.symbol),
        coingeckoId: item.id,
      }))
    },
  },
  {
    name: 'CoinPaprika',
    fetch: async (perPage: number, page: number): Promise<MarketItem[]> => {
      const res = await axios.get<CoinPaprikaItem[]>(
        'https://api.coinpaprika.com/v1/tickers',
        {
          params: { limit: perPage, start: (page - 1) * perPage + 1 },
          timeout: 10000,
        },
      )
      const list = Array.isArray(res.data) ? res.data : []
      return list.map((item) => {
        const q = item.quotes?.USD
        return {
          id: item.id,
          symbol: item.symbol,
          name: item.name,
          image: `https://static.coinpaprika.com/coin/${item.id}/logo.png`,
          current_price: q?.price ?? 0,
          price_change_percentage_24h: q?.percent_change_24h ?? null,
          market_cap: q?.market_cap,
          chain: getChain(item.id, item.symbol),
          coingeckoId: COINGECKO_ID_MAP[item.id] ?? item.id,
        }
      })
    },
  },
  {
    name: 'CoinCap',
    fetch: async (perPage: number): Promise<MarketItem[]> => {
      const res = await axios.get<{ data: CoinCapItem[] }>(
        'https://api.coincap.io/v2/assets',
        {
          params: { limit: perPage },
          timeout: 10000,
        },
      )
      const list = res.data?.data ?? []
      return list.map((item) => ({
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        image: `https://assets.coincap.io/assets/icons/${item.symbol.toLowerCase()}@2x.png`,
        current_price: parseFloat(item.priceUsd) || 0,
        price_change_percentage_24h: item.changePercent24Hr != null ? parseFloat(item.changePercent24Hr) : null,
        market_cap: item.marketCapUsd != null ? parseFloat(item.marketCapUsd) : undefined,
        chain: getChain(item.id, item.symbol),
        coingeckoId: COINGECKO_ID_MAP[item.id] ?? item.id,
      }))
    },
  },
  {
    name: 'Birdeye',
    fetch: async (perPage: number): Promise<MarketItem[]> => {
      const apiKey = (import.meta as any).env?.VITE_BIRDEYE_API_KEY as string | undefined
      if (!apiKey) throw new Error('Birdeye API key not configured (VITE_BIRDEYE_API_KEY)')
      const chains: Array<{ id: string; chain: ChainId }> = [
        { id: 'ethereum', chain: 'eth' },
        { id: 'bsc', chain: 'bsc' },
        { id: 'base', chain: 'base' },
      ]
      const limitPerChain = Math.min(50, Math.ceil(perPage / chains.length))
      const all: MarketItem[] = []
      for (const { id: chainId, chain } of chains) {
        const res = await axios.get<{ success: boolean; data?: { items?: BirdeyeTokenItem[] } }>(
          'https://public-api.birdeye.so/defi/v3/token/list',
          {
            params: {
              sort_by: 'market_cap',
              sort_type: 'desc',
              limit: limitPerChain,
            },
            headers: {
              'X-API-KEY': apiKey,
              'x-chain': chainId,
            },
            timeout: 10000,
          },
        )
        const items = res.data?.data?.items ?? []
        for (const item of items) {
          const price = item.price ?? 0
          if (price <= 0) continue
          all.push({
            id: `${chainId}:${item.address}`,
            symbol: item.symbol,
            name: item.name,
            image: item.logo_uri ?? '',
            current_price: price,
            price_change_percentage_24h: item.price_change_24h_percent ?? null,
            market_cap: item.market_cap,
            chain,
            coingeckoId: item.extensions?.coingecko_id,
          })
        }
      }
      return all
        .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
        .slice(0, perPage)
    },
  },
  {
    name: 'DexScreener',
    fetch: async (perPage: number): Promise<MarketItem[]> => {
      const queries = [
        // 主流/稳定币/链关键词（尽量覆盖每条链的热门池）
        'usdc', 'usdt', 'weth', 'eth', 'bnb', 'matic', 'base',
        // 热门代币关键词
        'pepe', 'shib', 'uni', 'link', 'aave', 'arb', 'op',
        // 原有
        'bitcoin', 'ethereum', 'chainlink', 'uniswap', 'avax',
      ]
      const seen = new Set<string>()
      const all: MarketItem[] = []
      const results = await Promise.all(
        queries.map((q) =>
          axios
            .get<{ pairs?: DexScreenerPair[] }>(`https://api.dexscreener.com/latest/dex/search`, {
              params: { q },
              timeout: 10000,
            })
            .then((r) => r.data?.pairs ?? [])
            .catch(() => [] as DexScreenerPair[]),
        ),
      )
      for (const pairs of results) {
        for (const p of pairs) {
          const key = `${p.chainId}:${p.baseToken.address}`
          if (seen.has(key)) continue
          const price = parseFloat(p.priceUsd ?? '0') || 0
          if (price <= 0 || (p.marketCap ?? 0) < 10_000) continue
          const chain = DEXSCREENER_CHAIN_MAP[p.chainId]
          if (!chain) continue
          seen.add(key)
          all.push({
            id: key,
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            image: p.info?.imageUrl ?? '',
            current_price: price,
            price_change_percentage_24h: p.priceChange?.h24 ?? null,
            market_cap: p.marketCap,
            chain,
            coingeckoId: undefined,
          })
        }
      }
      return all
        .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
        .slice(0, perPage)
    },
  },
]

export interface FetchMarketsResult {
  data: MarketItem[]
  provider: string
}

/** 依次尝试多个 API，直到成功 */
export async function fetchMarketsWithFallback(
  perPage = 20,
  page = 1,
): Promise<FetchMarketsResult> {
  const errors: string[] = []
  for (const api of MARKET_APIS) {
    try {
      const data = await api.fetch(perPage, page)
      if (data.length > 0) {
        return { data, provider: api.name }
      }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? `${e.message} (${e.response?.status ?? '?'})` : String(e)
      errors.push(`${api.name}: ${msg}`)
      console.warn(`[Markets] ${api.name} failed:`, msg)
    }
  }
  throw new Error(`所有 API 均失败: ${errors.join('; ')}`)
}

/** 优先拉链上 Dex 市场（DexScreener/Birdeye），再回退聚合行情 */
export async function fetchOnchainMarketsWithFallback(
  perPage = 50,
  page = 1,
): Promise<FetchMarketsResult> {
  const errors: string[] = []
  const onchainFirst = MARKET_APIS.filter((a) => a.name === 'DexScreener' || a.name === 'Birdeye')
  const rest = MARKET_APIS.filter((a) => !onchainFirst.includes(a))
  for (const api of [...onchainFirst, ...rest]) {
    try {
      const data = await api.fetch(perPage, page)
      if (data.length > 0) return { data, provider: api.name }
    } catch (e) {
      const msg = axios.isAxiosError(e) ? `${e.message} (${e.response?.status ?? '?'})` : String(e)
      errors.push(`${api.name}: ${msg}`)
      console.warn(`[Markets] ${api.name} failed:`, msg)
    }
  }
  throw new Error(`所有 API 均失败: ${errors.join('; ')}`)
}

/** 按公链分组 */
export function groupByChain(items: MarketItem[]): Map<ChainId, MarketItem[]> {
  const map = new Map<ChainId, MarketItem[]>()
  for (const item of items) {
    const list = map.get(item.chain) ?? []
    list.push(item)
    map.set(item.chain, list)
  }
  return map
}

/** 判断是否为 EVM 合约地址（0x...） */
export function isContractAddress(q: string): boolean {
  const s = q.trim()
  return s.startsWith('0x') && s.length === 42
}

/** URL / 手动配置里 id 前缀 → 内部 ChainId（Dex 返回多为 ethereum: 地址） */
function dexIdPrefixToChain(prefix: string): ChainId | null {
  const p = prefix.trim().toLowerCase()
  if (p === 'eth' || p === 'ethereum' || p === 'mainnet') return 'eth'
  if (p === 'bsc' || p === 'bnb' || p === 'binance') return 'bsc'
  if (p === 'base') return 'base'
  if (p === 'polygon' || p === 'matic' || p === 'polygon_pos') return 'polygon'
  return null
}

export type SearchByAddressOptions = {
  /** 为 true 时包含无 USD 价的池子，供详情页匹配手动热门等场景 */
  allowZeroPrice?: boolean
}

/** 按合约地址或关键词搜索（DexScreener） */
export async function searchByAddressOrQuery(query: string, options?: SearchByAddressOptions): Promise<MarketItem[]> {
  const q = query.trim()
  if (!q) return []
  const res = await axios.get<{ pairs?: DexScreenerPair[] }>(
    'https://api.dexscreener.com/latest/dex/search',
    { params: { q }, timeout: 10000 },
  )
  const pairs = res.data?.pairs ?? []
  const seen = new Set<string>()
  const items: MarketItem[] = []
  for (const p of pairs) {
    const key = `${p.chainId}:${p.baseToken.address}`
    if (seen.has(key)) continue
    const price = parseFloat(p.priceUsd ?? '0') || 0
    if (!options?.allowZeroPrice && price <= 0) continue
    const chain = DEXSCREENER_CHAIN_MAP[p.chainId]
    if (!chain) continue
    seen.add(key)
    items.push({
      id: key,
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      image: p.info?.imageUrl ?? '',
      current_price: price,
      price_change_percentage_24h: p.priceChange?.h24 ?? null,
      market_cap: p.marketCap,
      chain,
      coingeckoId: undefined,
    })
  }
  return items
}

/** Dex 行情项 id（如 ethereum:0x…）→ 小写 0x 合约地址 */
export function dexMarketIdToTokenAddress(id: string): string {
  const i = id.indexOf(':')
  const raw = i >= 0 ? id.slice(i + 1).trim() : id.trim()
  const lower = raw.toLowerCase()
  if (!lower) return lower
  return lower.startsWith('0x') ? lower : `0x${lower}`
}

/**
 * 兑换选币器：与首页搜索同源（DexScreener），再按当前 EVM 网络过滤。
 * 解决「首页能搜合约、兑换里只有内置列表」的差异。
 */
export async function searchSwapPickerMarketItems(
  query: string,
  network: 'mainnet' | 'base' | 'bsc',
): Promise<MarketItem[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const items = await searchByAddressOrQuery(q)
  const want: ChainId = network === 'mainnet' ? 'eth' : network === 'base' ? 'base' : 'bsc'
  return items.filter((it) => it.chain === want)
}

/** 按 chainId:address 获取单个 DexScreener 代币 */
export async function fetchDexTokenById(id: string): Promise<MarketItem | null> {
  const idx = id.indexOf(':')
  if (idx === -1) return null
  const prefix = id.slice(0, idx)
  const wantChain = dexIdPrefixToChain(prefix)
  const addrNorm = dexMarketIdToTokenAddress(id)
  if (!addrNorm.startsWith('0x') || addrNorm.length !== 42) return null

  const items = await searchByAddressOrQuery(addrNorm, { allowZeroPrice: true })

  const byChain = wantChain
    ? items.filter((item) => item.chain === wantChain && dexMarketIdToTokenAddress(item.id) === addrNorm)
    : items.filter((item) => dexMarketIdToTokenAddress(item.id) === addrNorm)

  if (byChain.length > 0) return byChain[0]

  const loose = items.find((item) => dexMarketIdToTokenAddress(item.id) === addrNorm)
  return loose ?? null
}
