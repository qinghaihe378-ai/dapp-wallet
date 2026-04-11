import type { BotChain } from './parseBuyMessage'

export type ParsedDeployErc20Intent = {
  chain: BotChain
  name: string
  symbol: string
  /** 人类可读总供应量（18 位小数），如 1000000 */
  totalSupplyHuman: string
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

/**
 * 解析自建 ERC20 部署口令，与买币分流使用。
 * 示例：bsc 发币 名称 我的币 符号 MTK 总量 1000000
 * 示例：base 部署 名称 Test Coin 符号 TST 总量 1000000000
 */
export function parseDeployErc20Message(text: string): ParsedDeployErc20Intent | null {
  const raw = text.trim()
  if (!raw) return null

  let chain: BotChain | null = null
  let body = raw

  const chainFirst = raw.match(/^(bsc|bnb|eth|ethereum|mainnet|base)\s+(.+)$/i)
  if (chainFirst) {
    chain = normalizeChain(chainFirst[1])
    if (!chain) return null
    body = chainFirst[2].trim()
  }

  const deployLead = body.match(/^(?:发币|部署|deploy)\s+(.+)$/i)
  if (deployLead) body = deployLead[1].trim()

  const chainSecond = body.match(/^(bsc|bnb|eth|ethereum|mainnet|base)\s+(.+)$/i)
  if (chainSecond) {
    const c = normalizeChain(chainSecond[1])
    if (!c) return null
    chain = c
    body = chainSecond[2].trim()
  }

  const nameSym = body.match(/名称\s+(.+?)\s+符号\s+(\S+)\s+总量\s+([0-9][0-9_.]*(?:\.[0-9]+)?)\s*$/i)
  if (!nameSym) return null

  const name = nameSym[1].trim()
  const symbol = nameSym[2].trim()
  const totalRaw = nameSym[3].trim().replace(/_/g, '')
  if (!name || !symbol || !totalRaw) return null

  if (!chain) {
    chain = 'mainnet'
  }

  return {
    chain,
    name,
    symbol,
    totalSupplyHuman: totalRaw,
  }
}
