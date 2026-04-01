/** DexScreener 链 id */
export function botChainToDexChainId(chain: string): string {
  const c = chain.toLowerCase()
  if (c === 'mainnet' || c === 'eth') return 'ethereum'
  if (c === 'bsc') return 'bsc'
  if (c === 'base') return 'base'
  if (c === 'solana' || c === 'sol') return 'solana'
  return 'ethereum'
}

export async function fetchTokenPriceUsd(chain: string, tokenAddress: string): Promise<number | null> {
  const dexChain = botChainToDexChainId(chain)
  const addr = tokenAddress.trim()
  if (!addr) return null
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${dexChain}/${encodeURIComponent(addr)}`)
    if (!res.ok) return null
    const json = (await res.json()) as { pairs?: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> }
    const p = json.pairs?.[0]
    const px = p?.priceUsd ? parseFloat(p.priceUsd) : NaN
    return Number.isFinite(px) ? px : null
  } catch {
    return null
  }
}

export async function fetchPairLiquidityUsd(chain: string, tokenAddress: string): Promise<number | null> {
  const dexChain = botChainToDexChainId(chain)
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${dexChain}/${encodeURIComponent(tokenAddress.trim())}`)
    if (!res.ok) return null
    const json = (await res.json()) as { pairs?: Array<{ liquidity?: { usd?: number } }> }
    const liq = json.pairs?.[0]?.liquidity?.usd
    return typeof liq === 'number' ? liq : null
  } catch {
    return null
  }
}
