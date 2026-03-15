import { Connection, PublicKey } from '@solana/web3.js'
import { NETWORK_CONFIG } from '../lib/walletConfig'

/** 按 mint 地址获取 Solana 代币信息（Jupiter Token API） */
export interface JupiterTokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
}

const SOLANA_RPC_URLS = NETWORK_CONFIG.solana.rpcUrls

/** SPL Mint 账户布局：decimals 在 offset 44（mint_authority 36 + supply 8） */
const SPL_MINT_DECIMALS_OFFSET = 44

async function tryFetchDecimalsOneRpc(rpcUrl: string, pubkey: PublicKey): Promise<number | null> {
  const conn = new Connection(rpcUrl, { commitment: 'confirmed' })
  try {
    const supply = await conn.getTokenSupply(pubkey)
    const decimals = supply?.value?.decimals
    if (typeof decimals === 'number' && decimals >= 0 && decimals <= 255) return decimals
  } catch {
    /* ignore */
  }
  try {
    const account = await conn.getAccountInfo(pubkey)
    if (account?.data && account.data.length > SPL_MINT_DECIMALS_OFFSET) {
      const decimals = account.data[SPL_MINT_DECIMALS_OFFSET]
      if (typeof decimals === 'number' && decimals >= 0 && decimals <= 255) return decimals
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 从链上读取 decimals，多 RPC 回退 */
async function fetchTokenDecimalsFromChain(mint: string): Promise<number | null> {
  const pubkey = new PublicKey(mint)
  for (const rpc of SOLANA_RPC_URLS) {
    const decimals = await tryFetchDecimalsOneRpc(rpc, pubkey)
    if (decimals != null) return decimals
  }
  return null
}

function makeUnknownToken(mint: string, decimals: number): JupiterTokenInfo {
  return {
    address: mint,
    symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
    name: 'Unknown',
    decimals,
  }
}

export async function fetchTokenByMint(mint: string): Promise<JupiterTokenInfo | null> {
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${mint}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      const decimals = await fetchTokenDecimalsFromChain(mint)
      return makeUnknownToken(mint, decimals ?? 6)
    }
    const data = (await res.json()) as { address?: string; symbol?: string; name?: string; decimals?: number }
    if (!data?.address) {
      const decimals = await fetchTokenDecimalsFromChain(mint)
      return makeUnknownToken(mint, decimals ?? 6)
    }
    return {
      address: data.address,
      symbol: data.symbol ?? mint.slice(0, 8),
      name: data.name ?? 'Unknown',
      decimals: typeof data.decimals === 'number' ? data.decimals : 6,
    }
  } catch {
    const decimals = await fetchTokenDecimalsFromChain(mint)
    return makeUnknownToken(mint, decimals ?? 6)
  }
}

/** 判断是否为 Solana mint 格式（base58，32-50 字符，避免漏判） */
export function isSolanaMint(s: string): boolean {
  const trimmed = s.trim()
  return /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(trimmed)
}

/** 判断是否为 EVM 合约地址 */
export function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim())
}
