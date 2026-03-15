/** Solana 主流代币（Jupiter 常用），与 EvmToken 兼容的 address 字段用于 SwapPage */
export interface SolanaToken {
  symbol: string
  name: string
  mint: string
  address: string
  decimals: number
  isNative: boolean
  tone: string
  priceUsd?: number
}

function withAddress(t: Omit<SolanaToken, 'address'>): SolanaToken {
  return { ...t, address: t.mint }
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

export const SOLANA_TOKENS: SolanaToken[] = [
  withAddress({
    symbol: 'SOL',
    name: 'Solana',
    mint: SOL_MINT,
    decimals: 9,
    isNative: true,
    tone: 'solana',
    priceUsd: 165,
  }),
  withAddress({
    symbol: 'USDC',
    name: 'USD Coin',
    mint: USDC_MINT,
    decimals: 6,
    isNative: false,
    tone: 'usdc',
    priceUsd: 1,
  }),
  withAddress({
    symbol: 'USDT',
    name: 'Tether USD',
    mint: USDT_MINT,
    decimals: 6,
    isNative: false,
    tone: 'emerald',
    priceUsd: 1,
  }),
]

export function getSolanaTokenByMint(mint: string): SolanaToken | null {
  return SOLANA_TOKENS.find((t) => t.mint === mint) ?? null
}

export function getSolanaTokenBySymbol(symbol: string): SolanaToken | null {
  return SOLANA_TOKENS.find((t) => t.symbol === symbol) ?? null
}
