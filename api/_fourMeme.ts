import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL as string)
const FOUR_SNAPSHOT_KEY_PREFIX = 'clawdex:fourmeme:snapshot:'

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
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as FourMemeSnapshot
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
    if (!parsed) return null
    await redis.set(cacheKey, JSON.stringify(parsed), 'EX', 300)
    return parsed
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
