import axios from 'axios'

/** 网络 -> CoinGecko id（原生代币） */
const NATIVE_COINGECKO_IDS: Record<string, string> = {
  mainnet: 'ethereum',
  base: 'ethereum',
  bsc: 'binancecoin',
  polygon: 'matic-network',
  solana: 'solana',
}

/** 代币 symbol -> CoinGecko id（ERC20 等） */
const SYMBOL_COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  SOL: 'solana',
  MATIC: 'matic-network',
  USDC: 'usd-coin',
  USDT: 'tether',
  USDbC: 'usd-base-coin',
  WBTC: 'wrapped-bitcoin',
  cbBTC: 'wrapped-bitcoin',
  CAKE: 'pancakeswap-token',
}

/** Solana mint -> symbol（Jupiter 备用） */
const SOLANA_MINT_TO_SYMBOL: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
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

async function fetchFromJupiter(mintIds: string[]): Promise<Record<string, number>> {
  if (mintIds.length === 0) return {}
  const apiKey = import.meta.env.VITE_JUPITER_API_KEY
  const headers: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {}
  const res = await fetch(
    `https://api.jup.ag/price/v3?ids=${mintIds.join(',')}`,
    { headers, signal: AbortSignal.timeout(5000) },
  )
  if (!res.ok) return {}
  const data = (await res.json()) as Record<string, { usdPrice?: number }>
  const out: Record<string, number> = {}
  for (const [mint, item] of Object.entries(data ?? {})) {
    const p = item?.usdPrice
    const symbol = SOLANA_MINT_TO_SYMBOL[mint]
    if (typeof p === 'number' && p > 0 && symbol) out[symbol] = p
  }
  return out
}

/** 获取所有需要的价格（原生 + 常用代币），CoinGecko 失败时用 Jupiter 补 Solana */
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

  const solanaMints = Object.keys(SOLANA_MINT_TO_SYMBOL)
  const needSolana = solanaMints.some((m) => {
    const sym = SOLANA_MINT_TO_SYMBOL[m]
    return !(typeof prices[sym] === 'number' && prices[sym] > 0)
  })
  if (needSolana) {
    try {
      const jup = await fetchFromJupiter(solanaMints)
      prices = { ...prices, ...jup }
    } catch {
      /* ignore */
    }
  }

  cache = { prices, ts: now }
  return prices
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
  if (network) {
    const byNetwork = prices[`network:${network}`]
    if (typeof byNetwork === 'number' && byNetwork > 0) return byNetwork
  }
  return 0
}
