import { Redis } from 'ioredis'
import { Contract, JsonRpcProvider } from 'ethers'

const FOUR_SNAPSHOT_KEY_PREFIX = 'clawdex:fourmeme:snapshot:'
const FOUR_PROXY_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const FOUR_TRADE_TOPICS = [
  '0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19',
  '0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942',
]
const FOUR_RESERVED_SUPPLY = 200_000_000
const FOUR_TARGET_QUOTE_AMOUNT = 18
const BNB_USD_FEED = '0x0567F2323251f0Aab15c8DfB1967E4e8A7D42aeE'

let redis: Redis | null = null

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

let bscProvider: JsonRpcProvider | null = null

function getBscRpcUrl() {
  return (
    process.env.BSC_RPC_URL ||
    process.env.RPC_BSC_URL ||
    process.env.BSC_RPC_HTTP ||
    'https://bsc-rpc.publicnode.com'
  )
}

function getBscProvider() {
  if (bscProvider) return bscProvider
  bscProvider = new JsonRpcProvider(getBscRpcUrl(), 56)
  return bscProvider
}

function parseWordAmount(raw: string) {
  if (!raw) return 0
  const n = BigInt(`0x${raw}`)
  return Number(n) / 1e18
}

async function fetchFourMemeOnchainState(tokenAddress: string) {
  const provider = getBscProvider()
  const tokenNeedle = tokenAddress.toLowerCase().replace(/^0x/, '')
  const latest = await provider.getBlockNumber()
  let remainingSupply: number | null = null
  let priceChange24h: number | null = null

  try {
    const token = new Contract(
      tokenAddress,
      [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
      ],
      provider,
    )
    const [rawBalance, decimals] = await Promise.all([
      token.balanceOf(FOUR_PROXY_CONTRACT),
      token.decimals(),
    ])
    const proxyTokenBalance = Number(rawBalance) / (10 ** Number(decimals))
    remainingSupply = Math.max(0, proxyTokenBalance - FOUR_RESERVED_SUPPLY)
  } catch {
    // ignore token balance read failure and continue with event fallback
  }

  try {
    const recentLogs = await provider.getLogs({
      address: FOUR_PROXY_CONTRACT,
      topics: [FOUR_TRADE_TOPICS],
      fromBlock: Math.max(0, latest - 30_000),
      toBlock: latest,
    })
    const matched = recentLogs.filter((log) => `${log.data}${log.topics.join('')}`.toLowerCase().includes(tokenNeedle))
    if (matched.length >= 2) {
      const firstHex = matched[0].data.replace(/^0x/, '')
      const lastHex = matched[matched.length - 1].data.replace(/^0x/, '')
      if (firstHex.length >= 64 * 3 && lastHex.length >= 64 * 3) {
        const firstPrice = parseWordAmount(firstHex.slice(64 * 2, 64 * 3))
        const lastPrice = parseWordAmount(lastHex.slice(64 * 2, 64 * 3))
        if (firstPrice > 0) {
          priceChange24h = ((lastPrice - firstPrice) / firstPrice) * 100
        }
      }
    }
  } catch {
    // ignore recent trade scan failure
  }

  for (let start = latest - 50_000; start > Math.max(0, latest - 5_000_000); start -= 50_000) {
    const logs = await provider.getLogs({
      address: FOUR_PROXY_CONTRACT,
      topics: [FOUR_TRADE_TOPICS],
      fromBlock: Math.max(0, start),
      toBlock: Math.min(latest, start + 49_999),
    })

    for (let i = logs.length - 1; i >= 0; i -= 1) {
      const log = logs[i]
      const haystack = `${log.data}${log.topics.join('')}`.toLowerCase()
      if (!haystack.includes(tokenNeedle)) continue

      const hex = log.data.replace(/^0x/, '')
      if (hex.length < 64 * 8) continue
      const words = Array.from({ length: 8 }, (_, index) => hex.slice(index * 64, (index + 1) * 64))
      const eventRemainingSupply = parseWordAmount(words[6])
      const bondingQuoteAmount = parseWordAmount(words[7])
      const priceQuote = parseWordAmount(words[2])
      const mergedRemainingSupply = remainingSupply != null && remainingSupply >= 0 ? remainingSupply : eventRemainingSupply
      const progressPct = 100 - ((mergedRemainingSupply * 100) / (1_000_000_000 - FOUR_RESERVED_SUPPLY))

      return {
        remainingSupply: mergedRemainingSupply,
        bondingQuoteAmount,
        priceQuote,
        priceChange24h,
        progressPct: Math.max(0, Math.min(100, progressPct)),
        latestTradeBlock: log.blockNumber,
        latestTradeTx: log.transactionHash,
      }
    }
  }

  if (remainingSupply != null) {
    const progressPct = 100 - ((remainingSupply * 100) / (1_000_000_000 - FOUR_RESERVED_SUPPLY))
    return {
      remainingSupply,
      bondingQuoteAmount: null,
      priceQuote: null,
      priceChange24h,
      progressPct: Math.max(0, Math.min(100, progressPct)),
      latestTradeBlock: null,
      latestTradeTx: null,
    }
  }

  return null
}

async function fetchBnbUsdPrice() {
  const provider = getBscProvider()
  try {
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
  } catch {
    return null
  }
}

async function fetchFourMemeTokenMeta(tokenAddress: string) {
  const provider = getBscProvider()
  try {
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
  const marketCapUsd =
    priceQuote != null && bnbUsdPrice != null
      ? priceQuote * (meta.totalSupply || 1_000_000_000) * bnbUsdPrice
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
    virtualLiquidityUsd,
    volumeUsd: null,
    totalSupply: meta.totalSupply || 1_000_000_000,
    remainingSupply: onchain?.remainingSupply ?? null,
    bondingQuoteAmount: onchain?.bondingQuoteAmount ?? null,
    targetQuoteAmount: FOUR_TARGET_QUOTE_AMOUNT,
    progressPct: onchain?.progressPct ?? null,
    maxMarketCapUsd: null,
  }
}

function mergeFourSnapshotWithOnchain(snapshot: FourMemeSnapshot, onchain: Awaited<ReturnType<typeof fetchFourMemeOnchainState>>): FourMemeSnapshot {
  if (!onchain) return snapshot
  return {
    ...snapshot,
    priceQuote: (onchain.priceQuote ?? 0) > 0 ? onchain.priceQuote : snapshot.priceQuote,
    priceQuoteText: (onchain.priceQuote ?? 0) > 0 ? onchain.priceQuote!.toString() : snapshot.priceQuoteText,
    priceChange24h: onchain.priceChange24h ?? snapshot.priceChange24h,
    remainingSupply: onchain.remainingSupply != null ? onchain.remainingSupply : snapshot.remainingSupply,
    bondingQuoteAmount: (onchain.bondingQuoteAmount ?? 0) > 0 ? onchain.bondingQuoteAmount : snapshot.bondingQuoteAmount,
    progressPct: onchain.progressPct,
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
}

function parseCompactNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const text = String(raw).trim().replace(/[$,%\s]/g, '').replace(/,/g, '')
  if (!text) return null
  const m = text.match(/^(-?\d+(?:\.\d+)?)([KMB])?$/i)
  if (!m) {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  const base = Number(m[1])
  if (!Number.isFinite(base)) return null
  const unit = (m[2] ?? '').toUpperCase()
  const factor = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1
  return base * factor
}

function parseBracePrice(raw: string | null | undefined): number | null {
  if (!raw) return null
  const text = String(raw).trim().replace(/,/g, '')
  const brace = text.match(/^(\d+)\.0\{(\d+)\}(\d+)$/)
  if (brace) {
    return Number(`${brace[1]}.${'0'.repeat(Number(brace[2]))}${brace[3]}`)
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

function parsePercent(raw: string | null | undefined): number | null {
  if (!raw) return null
  const num = Number(String(raw).replace(/[%+\s]/g, ''))
  return Number.isFinite(num) ? num : null
}

function extractFirstMatch(text: string, regex: RegExp) {
  const match = text.match(regex)
  return match ?? null
}

function parseFourMarkdown(text: string, tokenAddress: string): FourMemeSnapshot | null {
  const tokenShort = `${tokenAddress.slice(0, 4)}...${tokenAddress.slice(-6)}`
  const titleMatch = extractFirstMatch(
    text,
    /!\[Image \d+: token image\]\((https?:\/\/[^\s)]+)\)\n\n([^\n]+)\n\n\s*\/\s*([^\n]+)\n\nCA:\n\n(?:0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{6}|[^\n]+)/i,
  )
  const priceBlockMatch = extractFirstMatch(
    text,
    /(?:Created by[\s\S]{0,500}?\n\n)?([0-9.{}]+)\s+([A-Za-z0-9$._-]+)\s*([+-][0-9.]+%)\n\nMarket Cap\$([0-9.,KMB]+)\n\nVirtual Liquidity\$([0-9.,KMB]+)\n\nVolume\$([0-9.,KMB]+)/i,
  )
  const progressMatch = extractFirstMatch(text, /Bonding Curve Progress\s*\n\s*\n([0-9.]+%)/i)
  const supplyMatch = extractFirstMatch(text, /Total Supply\s*:\s*([0-9,.\-]+)/i)
  const curveMatch = extractFirstMatch(
    text,
    /There are\s+([0-9,.\-]+)\s+(.+?)\s+still available for sale in the bonding curve and there is\s+([0-9,.\-]+)\s+([^(]+)\(Raised amount[:：]\s*([0-9,.\-]+)\s+([^)]+)\)\s+in the bonding curve\./i,
  )
  const maxMcapMatch = extractFirstMatch(text, /When the market cap reaches \$([0-9.,KMB]+)\s+all the liquidity/i)

  const name = titleMatch?.[2]?.trim() || tokenShort
  const symbol = titleMatch?.[3]?.trim() || tokenShort
  const imageUrl = titleMatch?.[1]?.trim() || null
  const priceQuoteText = priceBlockMatch?.[1]?.trim() || null
  const priceQuote = parseBracePrice(priceQuoteText)
  const quoteSymbol = priceBlockMatch?.[2]?.trim() || curveMatch?.[4]?.trim() || 'BNB'
  const priceChange24h = parsePercent(priceBlockMatch?.[3])
  const marketCapUsd = parseCompactNumber(priceBlockMatch?.[4] ?? maxMcapMatch?.[1])
  const virtualLiquidityUsd = parseCompactNumber(priceBlockMatch?.[5])
  const volumeUsd = parseCompactNumber(priceBlockMatch?.[6])
  const totalSupply = parseCompactNumber(supplyMatch?.[1])
  const remainingSupply = parseCompactNumber(curveMatch?.[1])
  const bondingQuoteAmount = parseCompactNumber(curveMatch?.[3])
  const targetQuoteAmount = parseCompactNumber(curveMatch?.[5])
  const progressPct = parsePercent(progressMatch?.[1])
  const maxMarketCapUsd = parseCompactNumber(maxMcapMatch?.[1])

  return {
    tokenAddress: tokenAddress.toLowerCase(),
    name,
    symbol,
    imageUrl,
    priceQuote,
    priceQuoteText,
    quoteSymbol,
    priceChange24h,
    marketCapUsd,
    virtualLiquidityUsd,
    volumeUsd,
    totalSupply,
    remainingSupply,
    bondingQuoteAmount,
    targetQuoteAmount,
    progressPct,
    maxMarketCapUsd,
  }
}

export async function fetchFourMemeTokenSnapshot(tokenAddress: string): Promise<FourMemeSnapshot | null> {
  const token = tokenAddress.toLowerCase()
  const cacheKey = `${FOUR_SNAPSHOT_KEY_PREFIX}${token}`
  const onchainPromise = fetchFourMemeOnchainState(token).catch(() => null)
  const bnbUsdPromise = fetchBnbUsdPrice().catch(() => null)
  const metaPromise = fetchFourMemeTokenMeta(token).catch(() => ({
    name: '',
    symbol: '',
    totalSupply: 1_000_000_000,
    decimals: 18,
  }))
  const cached = await safeRedisGet(cacheKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as FourMemeSnapshot
      const onchain = await onchainPromise
      return mergeFourSnapshotWithOnchain(parsed, onchain)
    } catch {
      // ignore invalid cache
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`https://r.jina.ai/http://https://four.meme/token/${token}`, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const text = await response.text()
    const parsed = parseFourMarkdown(text, token)
    const onchain = await onchainPromise
    const meta = await metaPromise
    const bnbUsdPrice = await bnbUsdPromise
    if (!parsed) {
      return buildOnchainOnlySnapshot(token, meta, onchain, bnbUsdPrice)
    }
    await safeRedisSet(cacheKey, JSON.stringify(parsed), 300)
    const merged = mergeFourSnapshotWithOnchain(parsed, onchain)
    if ((merged.priceQuote ?? 0) > 0 && bnbUsdPrice != null && (merged.totalSupply ?? 0) > 0) {
      merged.marketCapUsd = merged.priceQuote! * merged.totalSupply! * bnbUsdPrice
    }
    if ((merged.priceQuote ?? 0) > 0 && bnbUsdPrice != null && merged.remainingSupply != null && merged.bondingQuoteAmount != null) {
      merged.virtualLiquidityUsd = ((merged.remainingSupply * merged.priceQuote!) + merged.bondingQuoteAmount) * bnbUsdPrice
    }
    return merged
  } catch {
    const [onchain, meta, bnbUsdPrice] = await Promise.all([onchainPromise, metaPromise, bnbUsdPromise])
    return buildOnchainOnlySnapshot(token, meta, onchain, bnbUsdPrice)
  } finally {
    clearTimeout(timeout)
  }
}
