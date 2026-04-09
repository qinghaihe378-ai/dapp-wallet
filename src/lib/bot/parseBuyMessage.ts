/**
 * Bot 购买消息解析（仅 EVM）
 * 支持格式：bsc 买 0.1 BNB 的 USDT | base 买 10 USDC 的 0x... | eth 买 0.1 ETH 的 USDC
 */

export type BotChain = 'bsc' | 'mainnet' | 'base'

export interface ParsedBuyIntent {
  chain: BotChain
  amount: string
  payToken: string
  buyToken: string
}

const CHAIN_ALIASES: Record<string, BotChain> = {
  bsc: 'bsc',
  bnb: 'bsc',
  eth: 'mainnet',
  ethereum: 'mainnet',
  mainnet: 'mainnet',
  base: 'base',
}

function normalizeChain(s: string): BotChain | null {
  const key = s.trim().toLowerCase()
  return CHAIN_ALIASES[key] ?? null
}

/** 解析购买意图，返回 null 表示无法解析 */
export function parseBuyMessage(text: string): ParsedBuyIntent | null {
  const t = text.trim()
  if (!t) return null

  const buyMatch = t.match(/^(?:买|buy)\s+(.+)$/i)
  const rest = buyMatch ? buyMatch[1].trim() : t

  const chainFirst = rest.match(/^(bsc|bnb|eth|ethereum|mainnet|base)\s+(.+)$/i)
  let chain: BotChain | null = null
  let body = rest
  if (chainFirst) {
    chain = normalizeChain(chainFirst[1])
    if (!chain) return null
    body = chainFirst[2].trim()
  }
  const buyPrefix = body.match(/^(?:买|buy)\s+(.+)$/i)
  if (buyPrefix) body = buyPrefix[1].trim()

  const amountTokenMatch = body.match(/^([\d.]+)\s+([A-Za-z0-9]+)\s+的\s+(.+)$/)
  if (!amountTokenMatch) return null

  let [, amount, payToken, buyToken] = amountTokenMatch
  if (!amount || !payToken || !buyToken) return null

  buyToken = buyToken.trim()
  const evmAddrTrailing = buyToken.match(/^(0x[a-fA-F0-9]{40})([^a-fA-F0-9]+)$/)
  if (evmAddrTrailing) buyToken = evmAddrTrailing[1]

  const amountNum = parseFloat(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) return null

  const payUpper = payToken.trim().toUpperCase()
  const bt = buyToken.trim()
  const looksLikeSolanaMint = bt.length >= 32 && bt.length <= 55 && !bt.startsWith('0x')

  if (payUpper === 'SOL' || looksLikeSolanaMint) {
    return null
  }

  if (!chain) {
    if (payUpper === 'BNB') {
      chain = 'bsc'
    } else if (payUpper === 'ETH') {
      chain = 'mainnet'
    } else if (/^0x[a-fA-F0-9]{40}$/.test(bt)) {
      chain = 'base'
    } else {
      chain = 'mainnet'
    }
  }

  return {
    chain,
    amount,
    payToken: payUpper,
    buyToken,
  }
}
