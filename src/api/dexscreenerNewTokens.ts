import axios from 'axios'
import type { NewTokenItem } from './geckoterminal'

/**
 * DexScreener 没有“new pools”官方接口，这里用搜索接口聚合出“近期创建的 pair”，
 * 再按 pairCreatedAt 倒序近似实现“新币/新池”。
 */

type DexScreenerPair = {
  chainId: string
  dexId?: string
  pairAddress?: string
  pairCreatedAt?: number
  baseToken?: { address?: string; symbol?: string; name?: string }
  priceUsd?: string
  priceChange?: { h24?: number }
  fdv?: number
  liquidity?: { usd?: number }
}

const CHAIN_QUERY_SEEDS: Record<string, string[]> = {
  // 用高频关键词拉回更多新 pair，再按 chainId 过滤
  bsc: ['wbnb', 'usdt', 'busd', 'cake', 'bnb'],
  ethereum: ['weth', 'usdt', 'usdc', 'pepe', 'uniswap'],
  base: ['weth', 'usdc', 'aero', 'based', 'base'],
  polygon: ['wmatic', 'usdt', 'usdc', 'matic'],
  solana: ['sol', 'usdc', 'usdt', 'ray', 'jup'],
}

const CHAIN_NAME: Record<string, string> = {
  bsc: 'BSC',
  ethereum: 'Ethereum',
  base: 'Base',
  polygon: 'Polygon',
  solana: 'Solana',
}

function toNewTokenItem(pair: DexScreenerPair, chainId: string): NewTokenItem | null {
  const addr = pair.baseToken?.address ?? ''
  if (!addr) return null
  const symbol = pair.baseToken?.symbol ?? '—'
  const priceUsd = pair.priceUsd ?? '0'
  const reserveUsd = pair.liquidity?.usd != null ? String(pair.liquidity.usd) : '0'
  const fdvUsd = pair.fdv != null ? String(pair.fdv) : null
  const createdAtIso = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : new Date().toISOString()

  return {
    chainId,
    chainName: CHAIN_NAME[chainId] ?? chainId,
    tokenAddress: addr,
    symbol,
    poolName: `${symbol} / ?`,
    poolAddress: pair.pairAddress ?? addr,
    dexId: pair.dexId ?? 'dexscreener',
    priceUsd,
    fdvUsd,
    reserveUsd,
    poolCreatedAt: createdAtIso,
    priceChange24h: pair.priceChange?.h24 != null ? String(pair.priceChange.h24) : null,
  }
}

export async function fetchDexScreenerNewTokensForChain(chainId: string, limit = 40): Promise<NewTokenItem[]> {
  const seeds = CHAIN_QUERY_SEEDS[chainId] ?? ['usdt', 'usdc', 'eth']
  const results = await Promise.allSettled(
    seeds.map((q) =>
      axios
        .get<{ pairs?: DexScreenerPair[] }>('https://api.dexscreener.com/latest/dex/search', {
          params: { q },
          timeout: 10000,
        })
        .then((r) => r.data?.pairs ?? []),
    ),
  )
  const allPairs = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  const filtered = allPairs.filter((p) => p.chainId === chainId)

  const seen = new Set<string>()
  const items: NewTokenItem[] = []
  for (const p of filtered.sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0))) {
    const addr = (p.baseToken?.address ?? '').toLowerCase()
    if (!addr || seen.has(addr)) continue
    seen.add(addr)
    const item = toNewTokenItem(p, chainId)
    if (item) items.push(item)
    if (items.length >= limit) break
  }
  return items
}

export async function fetchDexScreenerAllNewTokens(): Promise<NewTokenItem[]> {
  const chains = ['ethereum', 'bsc', 'base', 'polygon', 'solana']
  const results = await Promise.allSettled(chains.map((c) => fetchDexScreenerNewTokensForChain(c)))
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

