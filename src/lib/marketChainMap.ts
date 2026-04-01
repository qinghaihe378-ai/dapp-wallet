import type { ChainId } from '../api/markets'
import type { Network } from './walletConfig'

/** 行情代币链标识 → 钱包/兑换页 Network */
export function marketChainIdToWalletNetwork(chain: ChainId): Network {
  switch (chain) {
    case 'eth':
      return 'mainnet'
    case 'bsc':
      return 'bsc'
    case 'base':
      return 'base'
    case 'sol':
      return 'solana'
    case 'polygon':
      return 'polygon'
    default:
      return 'mainnet'
  }
}
