import { decodeBytes32String, ethers } from 'ethers'
import { parseEvmAddressInput } from '../../api/jupiter'
import { ERC20_ABI, ERC20_ABI_BYTES32_SYMBOL, ERC20_ABI_DECIMALS_ONLY } from './abis'
import type { SupportedSwapNetwork } from './config'
import { getWalletTrackedTokens, type EvmToken } from './tokens'

function bytes32ToString(bytes32: string): string {
  if (!bytes32 || bytes32.length < 66) return ''
  try {
    return decodeBytes32String(bytes32)
  } catch {
    const hex = bytes32.startsWith('0x') ? bytes32.slice(2) : bytes32
    const chars: string[] = []
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16)
      if (byte === 0) break
      chars.push(String.fromCharCode(byte))
    }
    return chars.join('') || ''
  }
}

async function fetchEvmTokenByAddressWithProvider(
  provider: ethers.Provider,
  normalized: string,
): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const contract = new ethers.Contract(normalized, ERC20_ABI, provider)
    const [symbol, decimals] = await Promise.all([
      contract.symbol() as Promise<string>,
      contract.decimals() as Promise<number>,
    ])
    const sym = (symbol && String(symbol).trim()) || normalized.slice(0, 10)
    return { symbol: sym, decimals: Number(decimals) ?? 18 }
  } catch {
    try {
      const contractBytes32 = new ethers.Contract(normalized, ERC20_ABI_BYTES32_SYMBOL, provider)
      const [symbolBytes32, decimals] = await Promise.all([
        contractBytes32.symbol() as Promise<string>,
        contractBytes32.decimals() as Promise<number>,
      ])
      const sym = bytes32ToString(symbolBytes32) || normalized.slice(0, 10)
      return { symbol: sym, decimals: Number(decimals) ?? 18 }
    } catch {
      try {
        const contractDec = new ethers.Contract(normalized, ERC20_ABI_DECIMALS_ONLY, provider)
        const decimals = await contractDec.decimals() as Promise<number>
        const sym = `${normalized.slice(0, 6)}…${normalized.slice(-4)}`
        return { symbol: sym, decimals: Number(decimals) ?? 18 }
      } catch {
        return null
      }
    }
  }
}

export async function fetchEvmTokenByAddress(
  provider: ethers.Provider,
  address: string,
): Promise<{ symbol: string; decimals: number } | null> {
  const normalized = parseEvmAddressInput(address)
  if (!normalized) return null
  return fetchEvmTokenByAddressWithProvider(provider, normalized)
}

export interface TokenBalanceRow {
  symbol: string
  amount: string
}

export async function readNativeBalance(provider: ethers.Provider, address: string) {
  const raw = await provider.getBalance(address)
  return ethers.formatEther(raw)
}

export async function readTokenBalance(
  provider: ethers.Provider,
  address: string,
  token: EvmToken,
) {
  if (token.isNative) {
    return await readNativeBalance(provider, address)
  }

  const contract = new ethers.Contract(token.address, ERC20_ABI, provider)
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(address) as Promise<bigint>,
    contract.decimals() as Promise<number>,
  ])
  return ethers.formatUnits(raw, decimals)
}

export async function readTrackedTokenBalances(
  provider: ethers.Provider,
  address: string,
  network: SupportedSwapNetwork,
) {
  const rows: TokenBalanceRow[] = []
  for (const token of getWalletTrackedTokens(network)) {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider)
      const [raw, decimals] = await Promise.all([
        contract.balanceOf(address) as Promise<bigint>,
        contract.decimals() as Promise<number>,
      ])
      const amount = Number(ethers.formatUnits(raw, decimals))
      if (amount > 0) {
        rows.push({
          symbol: token.symbol,
          amount: amount.toFixed(4),
        })
      }
    } catch (error) {
      console.error(`Load balance failed: ${token.symbol}`, error)
    }
  }
  return rows
}
