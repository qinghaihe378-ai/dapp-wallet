import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'
import { Contract, JsonRpcProvider } from 'ethers'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60
const FOUR_KNOWN_TOKENS_KEY = 'clawdex:fourmeme:knownTokens'
const FOUR_CURSOR_KEY = 'clawdex:fourmeme:cursor'

const FOUR_MAIN_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
// 通过实测主合约日志得到的“新币创建候选事件”topic（两种路径）
const FOUR_CREATE_TOPICS = [
  '0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19',
  '0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942',
]

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
    'https://bsc-rpc.publicnode.com'
  )
}

async function fetchFourMemeOnchainNewTokens() {
  const provider = new JsonRpcProvider(getBscRpcUrl(), 56)
  const latest = await provider.getBlockNumber()
  const cursorRaw = await redis.get(FOUR_CURSOR_KEY)
  const knownRaw = await redis.get(FOUR_KNOWN_TOKENS_KEY)
  let cursor = cursorRaw ? Number(cursorRaw) : NaN
  if (!Number.isFinite(cursor)) {
    cursor = Math.max(0, latest - 300)
  }
  const fromBlock = Math.max(0, cursor + 1)
  const toBlock = latest
  if (toBlock < fromBlock) return []

  let knownTokens: string[] = []
  try {
    knownTokens = knownRaw ? (JSON.parse(knownRaw) as string[]) : []
  } catch {
    knownTokens = []
  }
  const knownSet = new Set((knownTokens ?? []).map((a) => String(a).toLowerCase()))

  const logs = await provider.getLogs({
    address: FOUR_MAIN_CONTRACT,
    topics: [FOUR_CREATE_TOPICS],
    fromBlock,
    toBlock,
  })

  const tokensFromLogs: string[] = []
  for (const lg of logs) {
    const hex = String(lg.data ?? '').replace(/^0x/, '')
    // data 至少含两个 32-byte slot：creator + token
    if (hex.length < 128) continue
    const word2 = hex.slice(64, 128)
    const token = `0x${word2.slice(24)}`.toLowerCase()
    if (token.startsWith('0x') && token.length === 42) {
      tokensFromLogs.push(token)
    }
  }

  const uniqueTokens = [...new Set(tokensFromLogs)]
  const targetTokens = uniqueTokens.filter((a) => !knownSet.has(a))
  await redis.set(FOUR_CURSOR_KEY, String(latest))
  if (targetTokens.length === 0) return []

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
    knownSet.add(token)
  }
  await redis.set(FOUR_KNOWN_TOKENS_KEY, JSON.stringify([...knownSet].slice(-3000)))
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
