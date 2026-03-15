export type Network = 'mainnet' | 'bsc' | 'polygon' | 'base' | 'solana'

export const NETWORK_CONFIG: Record<
  Network,
  { chainId: number; chainName: string; rpcUrls: string[]; symbol: string; explorerTxBase?: string }
> = {
  mainnet: {
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    symbol: 'ETH',
    explorerTxBase: 'https://etherscan.io/tx/',
  },
  base: {
    chainId: 8453,
    chainName: 'Base',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
      'https://rpc.ankr.com/base',
      'https://base-mainnet.public.blastapi.io',
    ],
    symbol: 'ETH',
    explorerTxBase: 'https://basescan.org/tx/',
  },
  bsc: {
    chainId: 56,
    chainName: 'BNB Smart Chain',
    rpcUrls: ['https://bsc.publicnode.com', 'https://bsc-dataseed1.binance.org', 'https://rpc.ankr.com/bsc'],
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
  solana: {
    chainId: 0,
    chainName: 'Solana Mainnet',
    rpcUrls: ['https://solana-rpc.publicnode.com', 'https://rpc.ankr.com/solana', 'https://api.mainnet-beta.solana.com'],
    symbol: 'SOL',
    explorerTxBase: 'https://solscan.io/tx/',
  },
}
