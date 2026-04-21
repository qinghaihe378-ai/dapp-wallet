export type Network = 'mainnet' | 'bsc' | 'polygon' | 'base'

export const NETWORK_CONFIG: Record<
  Network,
  { chainId: number; chainName: string; rpcUrls: string[]; symbol: string; explorerTxBase?: string }
> = {
  mainnet: {
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    rpcUrls: [
      'https://ethereum.publicnode.com',
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
    ],
    symbol: 'ETH',
    explorerTxBase: 'https://etherscan.io/tx/',
  },
  base: {
    chainId: 8453,
    chainName: 'Base',
    rpcUrls: [
      'https://base-rpc.publicnode.com',
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
    ],
    symbol: 'ETH',
    explorerTxBase: 'https://basescan.org/tx/',
  },
  bsc: {
    chainId: 56,
    chainName: 'BNB Smart Chain',
    rpcUrls: [
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc.publicnode.com',
      'https://rpc.ankr.com/bsc',
    ],
    symbol: 'BNB',
    explorerTxBase: 'https://bscscan.com/tx/',
  },
  polygon: {
    chainId: 137,
    chainName: 'Polygon',
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
    symbol: 'MATIC',
    explorerTxBase: 'https://polygonscan.com/tx/',
  },
}
