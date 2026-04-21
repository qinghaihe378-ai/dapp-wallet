import { Redis } from 'ioredis'
import { Contract, JsonRpcProvider } from 'ethers'

const FOUR_PROXY_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const PANCAKE_FACTORY_V2 = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73'
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const FOUR_TRADE_TOPICS = [
  '0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19',
  '0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942',
]
const FOUR_RESERVED_SUPPLY = 200_000_000
const FOUR_TARGET_QUOTE_AMOUNT = 18
const BNB_USD_FEED = '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee'
const FOUR_META_KEY_PREFIX = 'clawdex:fourmeme:meta:'
const FOUR_OFFICIAL_KEY_PREFIX = 'clawdex:fourmeme:official:'
const FOUR_OFFICIAL_BOARD_KEY = 'clawdex:fourmeme:official:board'
const BSC_CHAIN_ID = 56
const RPC_TIMEOUT_MS = 2_000
const OFFICIAL_TIMEOUT_MS = 12_000
const OFFICIAL_CACHE_TTL_SECONDS = 30
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

function parseCompactNumber(raw: string | null | undefined) {
  const text = String(raw ?? '').trim().replaceAll(',', '').replaceAll('$', '')
  if (!text) return null
  const matched = text.match(/^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$/i)
  if (!matched) {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(matched[1])
  const suffix = matched[2].toUpperCase()
  const scale =
    suffix === 'K'
      ? 1_000
      : suffix === 'M'
        ? 1_000_000
        : suffix === 'B'
          ? 1_000_000_000
          : suffix === 'T'
            ? 1_000_000_000_000
            : 1
  return Number.isFinite(n) ? n * scale : null
}

function parsePlainNumber(raw: string | null | undefined) {
  const text = String(raw ?? '').trim().replaceAll(',', '')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function parseFourPriceText(raw: string | null | undefined) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const compact = text.match(/^0\.0\{(\d+)\}(\d+)$/)
  if (compact) {
    const zeros = '0'.repeat(Number(compact[1]))
    const n = Number(`0.${zeros}${compact[2]}`)
    return Number.isFinite(n) ? n : null
  }
  return parsePlainNumber(text)
}

export interface ParsedFourMarkdown {
  priceQuote: number | null
  priceQuoteText: string | null
  quoteSymbol: string | null
  priceChange24h: number | null
  marketCapUsd: number | null
  virtualLiquidityUsd: number | null
  volumeUsd: number | null
  totalSupply: number | null
  remainingSupply: number | null
  bondingQuoteAmount: number | null
  targetQuoteAmount: number | null
  progressPct: number | null
  creationTime: string | null
}

export function parseFourMarkdown(markdown: string): ParsedFourMarkdown {
  const priceMatch = markdown.match(
    /([0-9.{}]+)\s+([A-Za-z0-9$._-]+)\s*([+-]?[0-9.]+%)\s+Market Cap\$([0-9.,KMBT]+)\s+Virtual Liquidity\$([0-9.,KMBT]+)\s+Volume\$([0-9.,KMBT]+)/i,
  )
  const curveMatch = markdown.match(
    /There are\s+([0-9,.\-]+)\s+(.+?)\s+still available for sale in the bonding curve and there is\s+([0-9,.\-]+)\s+([^(]+)\(Raised amount[:：]\s*([0-9,.\-]+)\s+([^)]+)\)\s+in the bonding curve\./is,
  )
  const progressMatch = markdown.match(/Bonding Curve Progress\s+([0-9.]+)%/i)
  const supplyMatch = markdown.match(/Total Supply\s*:\s*([0-9,.\-]+)/i)
  const creationTimeMatch = markdown.match(/Creation Time\s+([0-9/: -]+)/i)

  return {
    priceQuoteText: priceMatch?.[1] ?? null,
    priceQuote: parseFourPriceText(priceMatch?.[1]),
    quoteSymbol: priceMatch?.[2]?.trim() || null,
    priceChange24h: parsePlainNumber(priceMatch?.[3]?.replace('%', '')),
    marketCapUsd: parseCompactNumber(priceMatch?.[4]),
    virtualLiquidityUsd: parseCompactNumber(priceMatch?.[5]),
    volumeUsd: parseCompactNumber(priceMatch?.[6]),
    totalSupply: parsePlainNumber(supplyMatch?.[1]),
    remainingSupply: parsePlainNumber(curveMatch?.[1]),
    bondingQuoteAmount: parsePlainNumber(curveMatch?.[3]),
    targetQuoteAmount: parsePlainNumber(curveMatch?.[5]),
    progressPct: parsePlainNumber(progressMatch?.[1]),
    creationTime: creationTimeMatch?.[1]?.trim() || null,
  }
}

async function fetchOfficialMarkdown(tokenAddress: string) {
  const cacheKey = `${FOUR_OFFICIAL_KEY_PREFIX}${tokenAddress.toLowerCase()}`
  const cached = await safeRedisGet(cacheKey)
  if (cached) return cached
  const urls = [
    `https://r.jina.ai/http://four.meme/token/${tokenAddress}`,
    `https://r.jina.ai/https://four.meme/token/${tokenAddress}`,
  ]
  let lastError: unknown = null
  for (const url of urls) {
    try {
      const res = await withTimeout(
        fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0' },
        }),
        OFFICIAL_TIMEOUT_MS,
        `four.meme official fetch timeout: ${tokenAddress}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.trim()) {
        await safeRedisSet(cacheKey, text, OFFICIAL_CACHE_TTL_SECONDS)
        return text
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`four.meme official fetch failed: ${tokenAddress}`)
}

async function fetchOfficialBoardMarkdown() {
  const cached = await safeRedisGet(FOUR_OFFICIAL_BOARD_KEY)
  if (cached) return cached
  const urls = [
    'https://r.jina.ai/http://four.meme/en',
    'https://r.jina.ai/https://four.meme/en',
  ]
  let lastError: unknown = null
  for (const url of urls) {
    try {
      const res = await withTimeout(
        fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0' },
        }),
        OFFICIAL_TIMEOUT_MS,
        'four.meme board fetch timeout',
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.trim()) {
        await safeRedisSet(FOUR_OFFICIAL_BOARD_KEY, text, OFFICIAL_CACHE_TTL_SECONDS)
        return text
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('four.meme board fetch failed')
}

async function fetchOfficialFourMemeSnapshot(tokenAddress: string) {
  try {
    const markdown = await fetchOfficialMarkdown(tokenAddress)
    return parseFourMarkdown(markdown)
  } catch {
    return null
  }
}

export async function fetchFourMemeBoardTokenAddresses(limit = 24) {
  const markdown = await fetchOfficialBoardMarkdown()
  const matches = markdown.matchAll(/https?:\/\/four\.meme\/(?:en\/)?token\/(0x[a-f0-9]{40})/gi)
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const match of matches) {
    const token = String(match[1] ?? '').trim().toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(token) || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= limit) break
  }
  return tokens
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

async function fetchPancakeState(tokenAddress: string, tokenDecimals: number) {
  try {
    return await withBscProvider(async (provider) => {
      const factory = new Contract(
        PANCAKE_FACTORY_V2,
        ['function getPair(address,address) view returns (address)'],
        provider,
      )
      const pairAddress = String(await factory.getPair(tokenAddress, WBNB)).toLowerCase()
      if (!/^0x[a-f0-9]{40}$/.test(pairAddress) || /^0x0{40}$/.test(pairAddress.replace(/^0x/, ''))) {
        return null
      }
      const pair = new Contract(
        pairAddress,
        [
          'function getReserves() view returns (uint112,uint112,uint32)',
          'function token0() view returns (address)',
          'function token1() view returns (address)',
        ],
        provider,
      )
      const [reserves, token0, token1] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
        pair.token1(),
      ])
      const reserve0 = Number(reserves[0])
      const reserve1 = Number(reserves[1])
      const token0Lower = String(token0).toLowerCase()
      const token1Lower = String(token1).toLowerCase()
      const divisor = 10 ** tokenDecimals
      let priceQuote: number | null = null
      let quoteLiquidityAmount: number | null = null
      if (token0Lower === WBNB && reserve1 > 0) {
        quoteLiquidityAmount = reserve0 / 1e18
        priceQuote = (reserve0 / 1e18) / (reserve1 / divisor)
      } else if (token1Lower === WBNB && reserve0 > 0) {
        quoteLiquidityAmount = reserve1 / 1e18
        priceQuote = (reserve1 / 1e18) / (reserve0 / divisor)
      }
      return {
        pairAddress,
        priceQuote,
        quoteLiquidityAmount,
      }
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

function buildMergedSnapshot(
  tokenAddress: string,
  meta: Awaited<ReturnType<typeof fetchFourMemeTokenMeta>>,
  onchain: Awaited<ReturnType<typeof fetchFourMemeOnchainState>>,
  official: Awaited<ReturnType<typeof fetchOfficialFourMemeSnapshot>>,
  pancake: Awaited<ReturnType<typeof fetchPancakeState>>,
  bnbUsdPrice: number | null,
): FourMemeSnapshot | null {
  if (!onchain && !official && !meta.totalSupply) return null
  const totalSupply =
    official?.totalSupply ?? onchain?.totalSupply ?? (meta.totalSupply || 1_000_000_000)
  const isOuter = Boolean(pancake?.pairAddress && pancake?.priceQuote != null)
  const fallbackPriceQuote = isOuter ? (pancake?.priceQuote ?? null) : (onchain?.priceQuote ?? null)
  const priceQuote = official?.priceQuote ?? fallbackPriceQuote
  const priceQuoteText = official?.priceQuoteText ?? (priceQuote != null ? String(priceQuote) : null)
  const marketCapUsd =
    priceQuote != null && bnbUsdPrice != null
      ? priceQuote * totalSupply * bnbUsdPrice
      : null
  const currentPriceUsd =
    priceQuote != null && bnbUsdPrice != null
      ? priceQuote * bnbUsdPrice
      : null
  const fallbackQuoteLiquidityAmount =
    isOuter
      ? (pancake?.quoteLiquidityAmount ?? null)
      : (official?.bondingQuoteAmount ?? onchain?.bondingQuoteAmount ?? null)
  const fallbackVirtualLiquidityUsd =
    fallbackQuoteLiquidityAmount != null && bnbUsdPrice != null
      ? fallbackQuoteLiquidityAmount * bnbUsdPrice
      : null
  const virtualLiquidityUsd = official?.virtualLiquidityUsd ?? fallbackVirtualLiquidityUsd
  const effectiveProgressPct = official?.progressPct ?? onchain?.progressPct ?? null
  return {
    tokenAddress: tokenAddress.toLowerCase(),
    name: meta.name || tokenAddress.slice(0, 6),
    symbol: meta.symbol || tokenAddress.slice(0, 6),
    imageUrl: null,
    priceQuote,
    priceQuoteText,
    quoteSymbol: official?.quoteSymbol || 'BNB',
    priceChange24h: official?.priceChange24h ?? onchain?.priceChange24h ?? null,
    marketCapUsd: official?.marketCapUsd ?? marketCapUsd,
    currentPriceUsd,
    virtualLiquidityUsd,
    bondingRaisedUsd: virtualLiquidityUsd,
    volumeUsd: official?.volumeUsd ?? null,
    totalSupply,
    remainingSupply: official?.remainingSupply ?? onchain?.remainingSupply ?? null,
    bondingQuoteAmount: official?.bondingQuoteAmount ?? onchain?.bondingQuoteAmount ?? null,
    targetQuoteAmount: official?.targetQuoteAmount ?? onchain?.targetQuoteAmount ?? FOUR_TARGET_QUOTE_AMOUNT,
    progressPct: effectiveProgressPct,
    maxMarketCapUsd: null,
    isOuter,
    pairAddress: pancake?.pairAddress ?? null,
    createdAtText: official?.creationTime ?? null,
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
  bondingRaisedUsd?: number | null
  volumeUsd: number | null
  totalSupply: number | null
  remainingSupply: number | null
  bondingQuoteAmount: number | null
  targetQuoteAmount: number | null
  progressPct: number | null
  maxMarketCapUsd: number | null
  currentPriceUsd?: number | null
  isOuter?: boolean
  pairAddress?: string | null
  createdAtText?: string | null
  latestTradeBlock?: number | null
  latestTradeTx?: string | null
  updatedAt?: number
  source?: 'onchain' | 'official+onchain'
}

export async function fetchFourMemeTokenSnapshot(tokenAddress: string): Promise<FourMemeSnapshot | null> {
  const token = tokenAddress.toLowerCase()
  const [onchain, meta, bnbUsdPrice, official] = await Promise.all([
    fetchFourMemeOnchainState(token).catch(() => null),
    fetchFourMemeTokenMeta(token).catch(() => ({
      name: '',
      symbol: '',
      totalSupply: 1_000_000_000,
      decimals: 18,
    })),
    fetchBnbUsdPrice().catch(() => null),
    fetchOfficialFourMemeSnapshot(token).catch(() => null),
  ])
  const pancake = await fetchPancakeState(token, meta.decimals).catch(() => null)
  const snapshot = buildMergedSnapshot(token, meta, onchain, official, pancake, bnbUsdPrice)
  if (!snapshot) return null
  return {
    ...snapshot,
    latestTradeBlock: onchain?.latestTradeBlock ?? null,
    latestTradeTx: onchain?.latestTradeTx ?? null,
    updatedAt: Date.now(),
    source: official ? 'official+onchain' : 'onchain',
  }
}
