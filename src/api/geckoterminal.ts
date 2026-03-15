import type { SupportedSwapNetwork } from '../lib/evm/config'

const BASE = 'https://api.geckoterminal.com/api/v2'

export const SUPPORTED_NETWORKS = [
  { id: 'eth', name: 'Ethereum' },
  { id: 'bsc', name: 'BSC' },
  { id: 'base', name: 'Base' },
  { id: 'polygon_pos', name: 'Polygon' },
] as const

export interface NewTokenItem {
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
}

interface PoolAttrs {
  name: string
  base_token_price_usd: string
  address: string
  pool_created_at: string
  fdv_usd: string | null
  reserve_in_usd: string
  price_change_percentage?: { h24?: string }
}

interface PoolData {
  id: string
  type: string
  attributes: PoolAttrs
  relationships?: {
    base_token?: { data?: { id?: string } }
    quote_token?: { data?: { id?: string } }
    dex?: { data?: { id?: string } }
  }
}

interface ApiResponse {
  data?: PoolData[]
}

function parseTokenFromPool(pool: PoolData, chainId: string, chainName: string): NewTokenItem | null {
  const attrs = pool.attributes
  const baseTokenId = pool.relationships?.base_token?.data?.id ?? ''
  const dexId = pool.relationships?.dex?.data?.id ?? 'unknown'
  const tokenAddress = baseTokenId.includes('_') ? baseTokenId.split('_')[1] ?? '' : baseTokenId
  const symbol = attrs.name.split('/')[0]?.trim() ?? '—'
  return {
    chainId,
    chainName,
    tokenAddress,
    symbol,
    poolName: attrs.name,
    poolAddress: attrs.address,
    dexId,
    priceUsd: attrs.base_token_price_usd,
    fdvUsd: attrs.fdv_usd ?? null,
    reserveUsd: attrs.reserve_in_usd,
    poolCreatedAt: attrs.pool_created_at,
    priceChange24h: attrs.price_change_percentage?.h24 ?? null,
  }
}

export async function fetchNewPoolsForNetwork(networkId: string, networkName: string): Promise<NewTokenItem[]> {
  const url = `${BASE}/networks/${networkId}/new_pools?page=1`
  try {
    const res = await fetch(url)
    const json: ApiResponse = await res.json()
    const list = json.data ?? []
    return list
      .map((p) => parseTokenFromPool(p, networkId, networkName))
      .filter((t): t is NewTokenItem => t != null && !!t.tokenAddress)
  } catch (e) {
    console.error(`fetchNewPools ${networkId}`, e)
    return []
  }
}

export async function fetchAllNewTokens(): Promise<NewTokenItem[]> {
  const results = await Promise.all(
    SUPPORTED_NETWORKS.map((n) => fetchNewPoolsForNetwork(n.id, n.name)),
  )
  return results.flat()
}

/** 网络 ID 到链名映射 */
const NETWORK_TO_GT: Record<string, string> = {
  base: 'base',
  mainnet: 'eth',
  eth: 'eth',
  bsc: 'bsc',
}

export interface TokenPoolInfo {
  poolAddress: string
  dexId: string
  baseTokenAddress: string
  quoteTokenAddress: string
  feeBps: number | null
  reserveUsd: string
  poolName: string
}

/** 从池子名称解析费率（Uniswap V3 格式），如 "MOLT / WETH 1%" -> 10000, "0.3%" -> 3000 */
function parseFeeFromPoolName(name: string): number | null {
  const m = name.match(/(\d+\.?\d*)\s*%/)
  if (!m) return null
  const pct = parseFloat(m[1])
  if (!Number.isFinite(pct)) return null
  return Math.round(pct * 10000)
}

/** 获取代币的池子列表（用于报价路由发现） */
export async function fetchTokenPools(
  network: SupportedSwapNetwork,
  tokenAddress: string,
): Promise<TokenPoolInfo[]> {
  const gtNetwork = NETWORK_TO_GT[network]
  if (!gtNetwork) return []

  const addr = tokenAddress.trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return []

  try {
    const res = await fetch(`${BASE}/networks/${gtNetwork}/tokens/${addr}/pools?page=1`)
    const json: { data?: PoolData[] } = await res.json()
    const list = json.data ?? []

    return list.map((p) => {
      const attrs = p.attributes
      const baseId = p.relationships?.base_token?.data?.id ?? ''
      const quoteId = p.relationships?.quote_token?.data?.id ?? ''
      const baseAddr = baseId.includes('_') ? baseId.split('_')[1]?.toLowerCase() ?? '' : baseId.toLowerCase()
      const quoteAddr = quoteId.includes('_') ? quoteId.split('_')[1]?.toLowerCase() ?? '' : quoteId.toLowerCase()
      const dexId = p.relationships?.dex?.data?.id ?? 'unknown'
      const feeBps = parseFeeFromPoolName(attrs.name)
      return {
        poolAddress: attrs.address,
        dexId,
        baseTokenAddress: baseAddr,
        quoteTokenAddress: quoteAddr,
        feeBps,
        reserveUsd: attrs.reserve_in_usd ?? '0',
        poolName: attrs.name,
      }
    })
  } catch (e) {
    console.warn('[GeckoTerminal] fetchTokenPools', e)
    return []
  }
}

