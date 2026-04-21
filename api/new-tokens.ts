import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'
import { Contract, JsonRpcProvider } from 'ethers'
import { fetchFourMemeTokenSnapshot } from './_fourMeme.js'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60
const FOUR_MAIN_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const FOUR_META_KEY_PREFIX = 'clawdex:fourmeme:meta:'
// 通过实测主合约日志得到的“新币创建候选事件”topic（两种路径）
const FOUR_CREATE_TOPICS = [
  '0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19',
  '0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942',
]

function getBscRpcUrl() {
  return (
    process.env.BSC_RPC_URL ||
    process.env.RPC_BSC_URL ||
    process.env.BSC_RPC_HTTP ||
    'https://bsc-rpc.publicnode.com'
  )
}

const ERC20_META_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

async function getFourTokenMeta(provider: JsonRpcProvider, token: string) {
  const cacheKey = `${FOUR_META_KEY_PREFIX}${token}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      return JSON.parse(cached) as { symbol: string; name: string }
    } catch {
      // ignore broken cache
    }
  }

  const contract = new Contract(token, ERC20_META_ABI as any, provider)
  let symbol = `${token.slice(2, 6).toUpperCase()}`
  let name = symbol
  try {
    const [s, n] = await Promise.allSettled([contract.symbol(), contract.name()])
    if (s.status === 'fulfilled') {
      const v = String(s.value ?? '').trim()
      if (v) symbol = v
    }
    if (n.status === 'fulfilled') {
      const v = String(n.value ?? '').trim()
      if (v) name = v
    }
  } catch {
    // keep fallback
  }
  const meta = { symbol, name }
  await redis.set(cacheKey, JSON.stringify(meta), 'EX', 86400)
  return meta
}

async function fetchFourMemeOnchainNewTokens() {
  const provider = new JsonRpcProvider(getBscRpcUrl(), 56)
  const latest = await provider.getBlockNumber()
  // 固定扫描最近区块窗口，避免依赖游标导致“看不到”
  const fromBlock = Math.max(0, latest - 5000)
  const toBlock = latest

  const logs = await provider.getLogs({
    address: FOUR_MAIN_CONTRACT,
    topics: [FOUR_CREATE_TOPICS],
    fromBlock,
    toBlock,
  })

  const tokensFromLogs: string[] = []
  for (const lg of logs) {
    const hex = String(lg.data ?? '').replace(/^0x/, '')
    // 实测 four 创建日志中：第 1 个 slot 是 token 合约，第 2 个 slot 是创建者钱包
    if (hex.length < 64) continue
    const word1 = hex.slice(0, 64)
    const token = `0x${word1.slice(24)}`.toLowerCase()
    if (token.startsWith('0x') && token.length === 42) tokensFromLogs.push(token)
  }

  // 保留最近日志顺序，去重后取最新 120 个
  const seen = new Set<string>()
  const uniqueInOrder: string[] = []
  for (let i = tokensFromLogs.length - 1; i >= 0; i -= 1) {
    const t = tokensFromLogs[i]
    if (seen.has(t)) continue
    seen.add(t)
    uniqueInOrder.push(t)
    if (uniqueInOrder.length >= 24) break
  }
  const targetTokens = uniqueInOrder.reverse()
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
  }> = []

  const metas = new Map<string, { symbol: string; name: string }>()
  for (let i = 0; i < targetTokens.length; i += 12) {
    const batch = targetTokens.slice(i, i + 12)
    const results = await Promise.all(batch.map(async (token) => [token, await getFourTokenMeta(provider, token)] as const))
    for (const [token, meta] of results) metas.set(token, meta)
  }

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

  for (const token of targetTokens) {
    const meta = metas.get(token)
    const snapshot = snapshots.get(token)
    const symbol = meta?.symbol || `${token.slice(2, 6).toUpperCase()}`
    const name = meta?.name || symbol

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
      reserveUsd: String(Number(snapshot?.virtualLiquidityUsd ?? snapshot?.marketCapUsd ?? 0) || 0),
      volumeUsd: String(Number(snapshot?.volumeUsd ?? 0) || 0),
      poolCreatedAt: nowIso,
      priceChange24h:
        snapshot?.priceChange24h != null && Number.isFinite(snapshot.priceChange24h)
          ? String(snapshot.priceChange24h)
          : null,
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
