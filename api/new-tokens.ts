import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'
import { Interface, JsonRpcProvider, id } from 'ethers'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60
const FOUR_CURSOR_KEY = 'clawdex:fourmeme:cursor'

const FOUR_MAIN_CONTRACT = '0x5c952063c7fc8610ffdb798152d69f0b9550762b'
const FOUR_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'creator', type: 'address' },
      { indexed: true, internalType: 'address', name: 'token', type: 'address' },
      { indexed: false, internalType: 'string', name: 'name', type: 'string' },
      { indexed: false, internalType: 'string', name: 'symbol', type: 'string' },
      { indexed: false, internalType: 'string', name: 'uri', type: 'string' },
    ],
    name: 'TokenCreate',
    type: 'event',
  },
] as const
const FOUR_TOKEN_CREATE_TOPIC = id('TokenCreate(address,address,string,string,string)')

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
  const latest = await provider.getBlockNumber()
  const cursorRaw = await redis.get(FOUR_CURSOR_KEY)
  const cursor = cursorRaw ? Number(cursorRaw) : null

  // 按你的要求：首次仅从“最新区块”开始监听，不回扫历史
  if (!Number.isFinite(cursor) || cursor == null) {
    await redis.set(FOUR_CURSOR_KEY, String(latest))
    return []
  }

  if (latest <= cursor) return []

  const fromBlock = cursor + 1
  const toBlock = latest
  const logs = await provider.getLogs({
    address: FOUR_MAIN_CONTRACT,
    topics: [FOUR_TOKEN_CREATE_TOPIC],
    fromBlock,
    toBlock,
  })

  const iface = new Interface(FOUR_ABI as any)
  const blockTs = new Map<number, number>()
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

  for (const lg of logs) {
    const parsed = iface.parseLog({ topics: [...lg.topics], data: lg.data })
    if (!parsed || parsed.name !== 'TokenCreate') continue
    const token = String(parsed.args.token ?? '').toLowerCase()
    const symbol = String(parsed.args.symbol ?? '').trim() || '—'
    if (!token.startsWith('0x') || token.length !== 42) continue

    let ts = blockTs.get(Number(lg.blockNumber))
    if (!ts) {
      const b = await provider.getBlock(lg.blockNumber)
      ts = Number(b?.timestamp ?? Math.floor(Date.now() / 1000))
      blockTs.set(Number(lg.blockNumber), ts)
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
      poolCreatedAt: new Date((ts ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      priceChange24h: null,
    })
  }

  await redis.set(FOUR_CURSOR_KEY, String(latest))
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
    if (cached) {
      res.status(200).json(JSON.parse(cached))
      return
    }

    const [dexItems, fourItems] = await Promise.all([
      fetchDexScreenerAllNewTokens(),
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
