import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'
import { fetchFourMemeBoardTokenAddresses, fetchFourMemeTokenSnapshot } from './_fourMeme.js'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60

async function fetchFourMemeOnchainNewTokens() {
  const targetTokens = await fetchFourMemeBoardTokenAddresses(24)
  if (targetTokens.length === 0) return []

  const nowIso = new Date().toISOString()
  const items: Array<{
    chainId: string
    chainName: string
    tokenAddress: string
    symbol: string
    name: string
    poolName: string
    poolAddress: string
    dexId: string
    quoteSymbol: string
    priceUsd: string
    fdvUsd: string | null
    reserveUsd: string
    volumeUsd: string
    poolCreatedAt: string
    priceChange24h: string | null
    marketCapUsd: string | null
    bondingRaisedUsd: string | null
    isOuter: boolean
    progressPct: string | null
    remainingSupply: string | null
    bondingQuoteAmount: string | null
    targetQuoteAmount: string | null
    latestTradeBlock: number | null
    fourCreatedOrder: number
  }> = []

  const snapshots = new Map<
    string,
    Awaited<ReturnType<typeof fetchFourMemeTokenSnapshot>>
  >()
  for (let i = 0; i < targetTokens.length; i += 6) {
    const batch = targetTokens.slice(i, i + 6)
    const results = await Promise.all(
      batch.map(async (token) => [token, await fetchFourMemeTokenSnapshot(token).catch(() => null)] as const),
    )
    for (const [token, snapshot] of results) snapshots.set(token, snapshot)
  }

  for (const [index, token] of targetTokens.entries()) {
    const snapshot = snapshots.get(token)
    const symbol = snapshot?.symbol || `${token.slice(2, 6).toUpperCase()}`
    const name = snapshot?.name || symbol

    items.push({
      chainId: 'bsc',
      chainName: 'BSC',
      tokenAddress: token,
      symbol,
      name,
      poolName: name,
      poolAddress: token,
      dexId: 'four.meme',
      quoteSymbol: String(snapshot?.quoteSymbol ?? 'BNB'),
      priceUsd: String(Number(snapshot?.currentPriceUsd ?? 0) || 0),
      fdvUsd:
        snapshot?.marketCapUsd != null && Number.isFinite(snapshot.marketCapUsd)
          ? String(snapshot.marketCapUsd)
          : null,
      reserveUsd: String(Number(snapshot?.bondingRaisedUsd ?? 0) || 0),
      volumeUsd: String(Number(snapshot?.volumeUsd ?? 0) || 0),
      poolCreatedAt: snapshot?.createdAtText || nowIso,
      priceChange24h:
        snapshot?.priceChange24h != null && Number.isFinite(snapshot.priceChange24h)
          ? String(snapshot.priceChange24h)
          : null,
      marketCapUsd:
        snapshot?.marketCapUsd != null && Number.isFinite(snapshot.marketCapUsd)
          ? String(snapshot.marketCapUsd)
          : null,
      bondingRaisedUsd:
        snapshot?.bondingRaisedUsd != null && Number.isFinite(snapshot.bondingRaisedUsd)
          ? String(snapshot.bondingRaisedUsd)
          : null,
      isOuter: Boolean(snapshot?.isOuter),
      progressPct:
        snapshot?.progressPct != null && Number.isFinite(snapshot.progressPct)
          ? String(snapshot.progressPct)
          : null,
      remainingSupply:
        snapshot?.remainingSupply != null && Number.isFinite(snapshot.remainingSupply)
          ? String(snapshot.remainingSupply)
          : null,
      bondingQuoteAmount:
        snapshot?.bondingQuoteAmount != null && Number.isFinite(snapshot.bondingQuoteAmount)
          ? String(snapshot.bondingQuoteAmount)
          : null,
      targetQuoteAmount:
        snapshot?.targetQuoteAmount != null && Number.isFinite(snapshot.targetQuoteAmount)
          ? String(snapshot.targetQuoteAmount)
          : null,
      latestTradeBlock:
        snapshot?.latestTradeBlock != null && Number.isFinite(snapshot.latestTradeBlock)
          ? snapshot.latestTradeBlock
          : null,
      fourCreatedOrder: index,
    })
  }
  return items
}

export default async function handler(_req: any, res: any) {
  try {
    const sysRaw = await redis.get(SYSTEM_CONFIG_KEY)
    let ttlSeconds = DEFAULT_TTL_SECONDS
    if (sysRaw) {
      try {
        const sys = JSON.parse(sysRaw) as { newTokens?: { cacheTtlSeconds?: number } }
        ttlSeconds = Math.max(1, Number(sys?.newTokens?.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS))
      } catch {
        ttlSeconds = DEFAULT_TTL_SECONDS
      }
    }

    const cached = await redis.get(KEY)
    let cachedItems: any[] = []
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { items?: any[] }
        cachedItems = Array.isArray(parsed?.items) ? parsed.items : []
      } catch {
        cachedItems = []
      }
    }

    const [dexItems, fourItems] = await Promise.all([
      cachedItems.length > 0 ? Promise.resolve(cachedItems) : fetchDexScreenerAllNewTokens(),
      fetchFourMemeOnchainNewTokens().catch((e) => {
        console.error('four.meme onchain fetch failed', e)
        return []
      }),
    ])
    const dedup = new Map<string, any>()
    for (const it of [...dexItems, ...fourItems]) {
      const k = `${String(it.chainId ?? '').toLowerCase()}:${String(it.tokenAddress ?? '').toLowerCase()}:${String(it.dexId ?? '').toLowerCase()}`
      if (!dedup.has(k)) dedup.set(k, it)
    }
    const payload = { updatedAt: Date.now(), items: [...dedup.values()] }
    await redis.set(KEY, JSON.stringify(payload), 'EX', ttlSeconds)

    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
