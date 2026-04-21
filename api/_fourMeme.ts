import { Redis } from 'ioredis'
import { Contract, JsonRpcProvider } from 'ethers'

const FOUR_PROXY_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const FOUR_TRADE_TOPICS = [
  '0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19',
  '0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942',
]
const FOUR_RESERVED_SUPPLY = 200_000_000
const FOUR_TARGET_QUOTE_AMOUNT = 18
const BNB_USD_FEED = '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee'
const FOUR_META_KEY_PREFIX = 'clawdex:fourmeme:meta:'
const BSC_CHAIN_ID = 56
const RPC_TIMEOUT_MS = 2_000
const RECENT_LOG_WINDOW_BLOCKS = 28_800

let redis: Redis | null = null
let bscProviders: JsonRpcProvider[] | null = null

function getRedis() {
  if (redis) return redis
  const url = String(process.env.REDIS_URL ?? '').trim()
  if (!url) return null
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  })
  client.on('error', () => {})
  redis = client
  return redis
}

async function safeRedisGet(key: string) {
  const client = getRedis()
  if (!client) return null
  try {
    if (client.status === 'wait') await client.connect()
    return await client.get(key)
  } catch {
    return null
  }
}

async function safeRedisSet(key: string, value: string, ttlSeconds: number) {
  const client = getRedis()
  if (!client) return
  try {
    if (client.status === 'wait') await client.connect()
    await client.set(key, value, 'EX', ttlSeconds)
  } catch {
    // ignore cache write failure
  }
}

function getBscRpcUrls() {
  const urls = [
    process.env.BSC_RPC_URL,
    process.env.RPC_BSC_URL,
    process.env.BSC_RPC_HTTP,
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc.publicnode.com',
    'https://rpc.ankr.com/bsc',
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
  return [...new Set(urls)]
}

function getBscProviders() {
  if (bscProviders) return bscProviders
  bscProviders = getBscRpcUrls().map((url) => new JsonRpcProvider(url, BSC_CHAIN_ID, { staticNetwork: true }))
  return bscProviders
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function withBscProvider<T>(task: (provider: JsonRpcProvider) => Promise<T>) {
  const providers = getBscProviders()
  const tasks = providers.map((provider) =>
    withTimeout(task(provider), RPC_TIMEOUT_MS, `BSC RPC timeout: ${provider._getConnection().url}`),
  )
  try {
    return await Promise.any(tasks)
  } catch (error) {
    if (error instanceof AggregateError && error.errors?.length) {
      throw error.errors[0]
    }
    throw error
  }
}

function parseWordAmount(raw: string) {
  if (!raw) return 0
  const n = BigInt(`0x${raw}`)
  return Number(n) / 1e18
}

async function fetchFourMemeOnchainState(tokenAddress: string) {
  return withBscProvider(async (provider) => {
    const tokenNeedle = tokenAddress.toLowerCase().replace(/^0x/, '')
    const latest = await provider.getBlockNumber()
    let remainingSupply: number | null = null
    let bondingQuoteAmount: number | null = null
    let priceQuote: number | null = null
    let targetQuoteAmount: number | null = null
    let totalSupply: number | null = null
    let priceChange24h: number | null = null

    try {
      const four = new Contract(
        FOUR_PROXY_CONTRACT,
        [
          'function _tokenInfos(address) view returns (address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
        ],
        provider,
      )
      const tokenInfo = await four._tokenInfos(tokenAddress)
      totalSupply = Number(tokenInfo[3]) / 1e18
      remainingSupply = Number(tokenInfo[7]) / 1e18
      bondingQuoteAmount = Number(tokenInfo[8]) / 1e18
      priceQuote = Number(tokenInfo[9]) / 1e18
      targetQuoteAmount = Number(tokenInfo[5]) / 1e18
    } catch {
      // ignore token info read failure and continue with fallback
    }

    let latestTradeBlock: number | null = null
    let latestTradeTx: string | null = null
    try {
      const recentLogs = await provider.getLogs({
        address: FOUR_PROXY_CONTRACT,
        topics: [FOUR_TRADE_TOPICS],
        fromBlock: Math.max(0, latest - RECENT_LOG_WINDOW_BLOCKS),
        toBlock: latest,
      })
      const matched = recentLogs.filter((log) => `${log.data}${log.topics.join('')}`.toLowerCase().includes(tokenNeedle))
      if (matched.length > 0) {
        const firstHex = matched[0].data.replace(/^0x/, '')
        const lastHex = matched[matched.length - 1].data.replace(/^0x/, '')
        const lastLog = matched[matched.length - 1]
        latestTradeBlock = lastLog.blockNumber
        latestTradeTx = lastLog.transactionHash
        if (firstHex.length >= 64 * 3 && lastHex.length >= 64 * 3) {
          const firstPrice = parseWordAmount(firstHex.slice(64 * 2, 64 * 3))
          const lastPrice = parseWordAmount(lastHex.slice(64 * 2, 64 * 3))
          if (firstPrice > 0) {
            priceChange24h = ((lastPrice - firstPrice) / firstPrice) * 100
          }
        }
        if (priceChange24h == null) {
          priceChange24h = 0
        }
      }
    } catch {
      // ignore recent trade scan failure
    }

    if (remainingSupply != null || bondingQuoteAmount != null || priceQuote != null) {
      const effectiveTotalSupply = totalSupply && totalSupply > 0 ? totalSupply : 1_000_000_000
      const maxOffers = Math.max(0, effectiveTotalSupply - FOUR_RESERVED_SUPPLY)
      const progressPct =
        remainingSupply != null
          ? 100 - ((remainingSupply * 100) / maxOffers)
          : null
      return {
        remainingSupply,
        bondingQuoteAmount,
        targetQuoteAmount,
        totalSupply: effectiveTotalSupply,
        priceQuote,
        priceChange24h,
        progressPct: progressPct == null ? null : Math.max(0, Math.min(100, progressPct)),
        latestTradeBlock,
        latestTradeTx,
      }
    }

    return null
  })
}

async function fetchBnbUsdPrice() {
  try {
    return await withBscProvider(async (provider) => {
      const feed = new Contract(
        BNB_USD_FEED,
        [
          'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
          'function decimals() view returns (uint8)',
        ],
        provider,
      )
      const [roundData, decimals] = await Promise.all([
        feed.latestRoundData(),
        feed.decimals(),
      ])
      const answer = Number(roundData[1])
      return answer > 0 ? answer / (10 ** Number(decimals)) : null
    })
  } catch {
    return null
  }
}

async function fetchFourMemeTokenMeta(tokenAddress: string) {
  const cacheKey = `${FOUR_META_KEY_PREFIX}${tokenAddress.toLowerCase()}`
  const cached = await safeRedisGet(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as {
        name: string
        symbol: string
        totalSupply: number
        decimals: number
      }
    } catch {
      // ignore bad cache
    }
  }
  try {
    const meta = await withBscProvider(async (provider) => {
      const token = new Contract(
        tokenAddress,
        [
          'function name() view returns (string)',
          'function symbol() view returns (string)',
          'function totalSupply() view returns (uint256)',
          'function decimals() view returns (uint8)',
        ],
        provider,
      )
      const [name, symbol, totalSupplyRaw, decimals] = await Promise.all([
        token.name().catch(() => ''),
        token.symbol().catch(() => ''),
        token.totalSupply().catch(() => 0n),
        token.decimals().catch(() => 18),
      ])
      const divisor = 10 ** Number(decimals)
      return {
        name: String(name || '').trim(),
        symbol: String(symbol || '').trim(),
        totalSupply: Number(totalSupplyRaw) / divisor,
        decimals: Number(decimals),
      }
    })
    await safeRedisSet(cacheKey, JSON.stringify(meta), 86_400)
    return meta
  } catch {
    return {
      name: '',
      symbol: '',
      totalSupply: 1_000_000_000,
      decimals: 18,
    }
  }
}

function buildOnchainOnlySnapshot(
  tokenAddress: string,
  meta: Awaited<ReturnType<typeof fetchFourMemeTokenMeta>>,
  onchain: Awaited<ReturnType<typeof fetchFourMemeOnchainState>>,
  bnbUsdPrice: number | null,
): FourMemeSnapshot | null {
  if (!onchain && !meta.totalSupply) return null
  const priceQuote = onchain?.priceQuote ?? null
  const totalSupply = onchain?.totalSupply ?? (meta.totalSupply || 1_000_000_000)
  const marketCapUsd =
    priceQuote != null && bnbUsdPrice != null
      ? priceQuote * totalSupply * bnbUsdPrice
      : null
  const currentPriceUsd =
    priceQuote != null && bnbUsdPrice != null
      ? priceQuote * bnbUsdPrice
      : null
  const virtualLiquidityUsd =
    priceQuote != null && bnbUsdPrice != null && onchain?.remainingSupply != null && onchain?.bondingQuoteAmount != null
      ? ((onchain.remainingSupply * priceQuote) + onchain.bondingQuoteAmount) * bnbUsdPrice
      : null
  return {
    tokenAddress: tokenAddress.toLowerCase(),
    name: meta.name || tokenAddress.slice(0, 6),
    symbol: meta.symbol || tokenAddress.slice(0, 6),
    imageUrl: null,
    priceQuote,
    priceQuoteText: priceQuote != null ? String(priceQuote) : null,
    quoteSymbol: 'BNB',
    priceChange24h: onchain?.priceChange24h ?? null,
    marketCapUsd,
    currentPriceUsd,
    virtualLiquidityUsd,
    volumeUsd: null,
    totalSupply,
    remainingSupply: onchain?.remainingSupply ?? null,
    bondingQuoteAmount: onchain?.bondingQuoteAmount ?? null,
    targetQuoteAmount: onchain?.targetQuoteAmount ?? FOUR_TARGET_QUOTE_AMOUNT,
    progressPct: onchain?.progressPct ?? null,
    maxMarketCapUsd: null,
  }
}

export interface FourMemeSnapshot {
  tokenAddress: string
  name: string
  symbol: string
  imageUrl: string | null
  priceQuote: number | null
  priceQuoteText: string | null
  quoteSymbol: string
  priceChange24h: number | null
  marketCapUsd: number | null
  virtualLiquidityUsd: number | null
  volumeUsd: number | null
  totalSupply: number | null
  remainingSupply: number | null
  bondingQuoteAmount: number | null
  targetQuoteAmount: number | null
  progressPct: number | null
  maxMarketCapUsd: number | null
  currentPriceUsd?: number | null
  latestTradeBlock?: number | null
  latestTradeTx?: string | null
  updatedAt?: number
  source?: 'onchain'
}

export async function fetchFourMemeTokenSnapshot(tokenAddress: string): Promise<FourMemeSnapshot | null> {
  const token = tokenAddress.toLowerCase()
  const [onchain, meta, bnbUsdPrice] = await Promise.all([
    fetchFourMemeOnchainState(token).catch(() => null),
    fetchFourMemeTokenMeta(token).catch(() => ({
      name: '',
      symbol: '',
      totalSupply: 1_000_000_000,
      decimals: 18,
    })),
    fetchBnbUsdPrice().catch(() => null),
  ])
  const snapshot = buildOnchainOnlySnapshot(token, meta, onchain, bnbUsdPrice)
  if (!snapshot) return null
  return {
    ...snapshot,
    latestTradeBlock: onchain?.latestTradeBlock ?? null,
    latestTradeTx: onchain?.latestTradeTx ?? null,
    updatedAt: Date.now(),
    source: 'onchain',
  }
}
