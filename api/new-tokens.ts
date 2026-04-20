import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'
import { Contract, JsonRpcProvider } from 'ethers'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60
const FOUR_KNOWN_TOKENS_KEY = 'clawdex:fourmeme:knownTokens'

const FOUR_MAIN_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const FOUR_ABI = [
  {
    inputs: [],
    name: 'getAllTokens',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const ERC20_SYMBOL_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

function getBscRpcUrl() {
  return (
    process.env.BSC_RPC_URL ||
    process.env.RPC_BSC_URL ||
    process.env.BSC_RPC_HTTP ||
    'https://bsc-dataseed.binance.org'
  )
}

async function fetchFourMemeOnchainNewTokens() {
  const provider = new JsonRpcProvider(getBscRpcUrl(), 56)
  const main = new Contract(FOUR_MAIN_CONTRACT, FOUR_ABI as any, provider)
  const allTokensRaw = (await main.getAllTokens()) as string[]
  const allTokens = (Array.isArray(allTokensRaw) ? allTokensRaw : [])
    .map((a) => String(a).toLowerCase())
    .filter((a) => a.startsWith('0x') && a.length === 42)

  const knownRaw = await redis.get(FOUR_KNOWN_TOKENS_KEY)
  if (!knownRaw) {
    // 首次仅用于记录游标，但仍返回最近一批，避免前端空白
    await redis.set(FOUR_KNOWN_TOKENS_KEY, JSON.stringify(allTokens))
  }

  let knownTokens: string[] = []
  if (knownRaw) {
    try {
      knownTokens = JSON.parse(knownRaw) as string[]
    } catch {
      knownTokens = []
    }
  }
  const knownSet = new Set((knownTokens ?? []).map((a) => String(a).toLowerCase()))
  const newTokens = allTokens.filter((a) => !knownSet.has(a))
  // 前端展示使用最近 120 个 token，保证 Four 标签稳定有数据
  const recentTokens = allTokens.slice(Math.max(0, allTokens.length - 120))
  const targetTokens = recentTokens.length ? recentTokens : newTokens
  if (targetTokens.length === 0) return []

  await redis.set(FOUR_KNOWN_TOKENS_KEY, JSON.stringify(allTokens))

  const nowIso = new Date().toISOString()
  const items: Array<{
    chainId: string
    chainName: string
    tokenAddress: string
    symbol: string
    poolName: string
    poolAddress: string
    dexId: string
    priceUsd: string
    fdvUsd: string | null
    reserveUsd: string
    poolCreatedAt: string
    priceChange24h: string | null
  }> = []

  for (const token of targetTokens) {
    let symbol = 'NEW'
    try {
      const erc20 = new Contract(token, ERC20_SYMBOL_ABI as any, provider)
      const s = await erc20.symbol()
      const t = String(s ?? '').trim()
      if (t) symbol = t
    } catch {
      const short = `${token.slice(0, 6)}...${token.slice(-4)}`
      symbol = short
    }

    items.push({
      chainId: 'bsc',
      chainName: 'BSC',
      tokenAddress: token,
      symbol,
      poolName: symbol,
      poolAddress: token,
      dexId: 'four.meme',
      priceUsd: '0',
      fdvUsd: null,
      reserveUsd: '0',
      poolCreatedAt: nowIso,
      priceChange24h: null,
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
