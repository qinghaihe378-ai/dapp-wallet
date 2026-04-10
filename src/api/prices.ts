import axios from 'axios'

/** 网络 -> CoinGecko id（原生代币） */
const NATIVE_COINGECKO_IDS: Record<string, string> = {
  mainnet: 'ethereum',
  base: 'ethereum',
  bsc: 'binancecoin',
  polygon: 'matic-network',
}

/** 代币 symbol -> CoinGecko id（ERC20 等） */
const SYMBOL_COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  MATIC: 'matic-network',
  USDC: 'usd-coin',
  USDT: 'tether',
  USDbC: 'usd-base-coin',
  WBTC: 'wrapped-bitcoin',
  cbBTC: 'wrapped-bitcoin',
  CAKE: 'pancakeswap-token',
}

/** 稳定币固定价格 */
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'USDbC', 'DAI'])

const CACHE_MS = 60_000
let cache: { prices: Record<string, number>; ts: number } | null = null

async function fetchFromCoinGecko(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  const res = await axios.get<Record<string, { usd?: number }>>(
    'https://api.coingecko.com/api/v3/simple/price',
    {
      params: { ids: ids.join(','), vs_currencies: 'usd' },
      timeout: 6000,
    },
  )
  const out: Record<string, number> = {}
  for (const [id, data] of Object.entries(res.data ?? {})) {
    const p = data?.usd
    if (typeof p === 'number' && p > 0) out[id] = p
  }
  return out
}

/** 获取所有需要的价格（原生 + 常用代币） */
export async function fetchPrices(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cache && now - cache.ts < CACHE_MS) return cache.prices

  const ids = [
    ...new Set([
      ...Object.values(NATIVE_COINGECKO_IDS),
      ...Object.values(SYMBOL_COINGECKO_IDS),
    ]),
  ].filter(Boolean)

  let prices: Record<string, number> = {}
  try {
    const byId = await fetchFromCoinGecko(ids)
    for (const [symbol, cgId] of Object.entries(SYMBOL_COINGECKO_IDS)) {
      const p = byId[cgId]
      if (typeof p === 'number' && p > 0) prices[symbol] = p
    }
    for (const [network, cgId] of Object.entries(NATIVE_COINGECKO_IDS)) {
      const p = byId[cgId]
      if (typeof p === 'number' && p > 0) prices[`network:${network}`] = p
    }
  } catch {
    prices = {}
  }

  cache = { prices, ts: now }
  return prices
}

/** 各网络原生代币 symbol，仅在这些 symbol 上允许回退到 network: 价（避免未知山寨币误用 ETH/BNB 价） */
const NATIVE_SYMBOL_BY_NETWORK: Record<string, string> = {
  mainnet: 'ETH',
  base: 'ETH',
  bsc: 'BNB',
  polygon: 'MATIC',
}

/** 根据 symbol 或 network 获取价格 */
export function getPriceFromMap(
  prices: Record<string, number>,
  symbol: string,
  network?: string,
): number {
  if (STABLECOIN_SYMBOLS.has(symbol)) return 1
  const bySymbol = prices[symbol]
  if (typeof bySymbol === 'number' && bySymbol > 0) return bySymbol
  if (network && NATIVE_SYMBOL_BY_NETWORK[network] === symbol) {
    const byNetwork = prices[`network:${network}`]
    if (typeof byNetwork === 'number' && byNetwork > 0) return byNetwork
  }
  return 0
}
