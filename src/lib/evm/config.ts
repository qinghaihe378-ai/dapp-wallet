import type { Network } from '../walletConfig'

export type SupportedSwapNetwork = Extract<Network, 'mainnet' | 'base' | 'bsc'>
export type DexProtocolId =
  | 'uniswap-v2'
  | 'uniswap-v3'
  | 'uniswap-v4'
  | 'pancakeswap-v2'
  | 'pancakeswap-v3'
  | 'aerodrome-v2'

export type DexVersion = 'v2' | 'v3' | 'v4'
export type QuoteMode = 'v2' | 'v3' | 'unsupported'

export interface DexProtocolConfig {
  id: DexProtocolId
  label: string
  dexName: 'Uniswap' | 'PancakeSwap' | 'Aerodrome'
  version: DexVersion
  enabled: boolean
  routerAddress?: string
  quoterAddress?: string
  universalRouterAddress?: string
  wrappedNativeSymbol: string
  stableSymbols: string[]
  feeTiers?: number[]
  quoteMode: QuoteMode
  executeMode: QuoteMode
}

export interface EvmChainConfig {
  nativeSymbol: string
  wrappedNativeSymbol: string
  wrappedNativeAddress: string
  stableSymbols: string[]
  defaultProtocolOrder: DexProtocolId[]
  protocols: DexProtocolConfig[]
}

export const SUPPORTED_SWAP_NETWORKS: SupportedSwapNetwork[] = ['mainnet', 'base', 'bsc']

export const EVM_CHAIN_CONFIG: Record<SupportedSwapNetwork, EvmChainConfig> = {
  mainnet: {
    nativeSymbol: 'ETH',
    wrappedNativeSymbol: 'WETH',
    wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    stableSymbols: ['USDC', 'USDT'],
    defaultProtocolOrder: ['uniswap-v4', 'uniswap-v3', 'uniswap-v2'],
    protocols: [
      {
        id: 'uniswap-v4',
        label: 'Uniswap V4',
        dexName: 'Uniswap',
        version: 'v4',
        enabled: true,
        universalRouterAddress: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDT'],
        quoteMode: 'unsupported',
        executeMode: 'unsupported',
      },
      {
        id: 'uniswap-v3',
        label: 'Uniswap V3',
        dexName: 'Uniswap',
        version: 'v3',
        enabled: true,
        routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
        universalRouterAddress: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDT'],
        feeTiers: [100, 500, 3000, 10000],
        quoteMode: 'v3',
        executeMode: 'v3',
      },
      {
        id: 'uniswap-v2',
        label: 'Uniswap V2',
        dexName: 'Uniswap',
        version: 'v2',
        enabled: true,
        routerAddress: '0x7a250d5630b4cf539739df2c5dacab4c659f2488',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDT'],
        quoteMode: 'v2',
        executeMode: 'v2',
      },
    ],
  },
  base: {
    nativeSymbol: 'ETH',
    wrappedNativeSymbol: 'WETH',
    wrappedNativeAddress: '0x4200000000000000000000000000000000000006',
    stableSymbols: ['USDC', 'USDbC'],
    defaultProtocolOrder: ['uniswap-v4', 'uniswap-v3', 'uniswap-v2', 'aerodrome-v2'],
    protocols: [
      {
        id: 'uniswap-v4',
        label: 'Uniswap V4',
        dexName: 'Uniswap',
        version: 'v4',
        enabled: true,
        universalRouterAddress: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDbC'],
        quoteMode: 'unsupported',
        executeMode: 'unsupported',
      },
      {
        id: 'uniswap-v3',
        label: 'Uniswap V3',
        dexName: 'Uniswap',
        version: 'v3',
        enabled: true,
        routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
        quoterAddress: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        universalRouterAddress: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDbC'],
        feeTiers: [100, 500, 2500, 3000, 10000],
        quoteMode: 'v3',
        executeMode: 'v3',
      },
      {
        id: 'uniswap-v2',
        label: 'Uniswap V2',
        dexName: 'Uniswap',
        version: 'v2',
        enabled: true,
        routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDbC'],
        quoteMode: 'v2',
        executeMode: 'v2',
      },
      {
        id: 'aerodrome-v2',
        label: 'Aerodrome',
        dexName: 'Aerodrome',
        version: 'v2',
        enabled: true,
        routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
        wrappedNativeSymbol: 'WETH',
        stableSymbols: ['USDC', 'USDbC'],
        quoteMode: 'v2',
        executeMode: 'v2',
      },
    ],
  },
  bsc: {
    nativeSymbol: 'BNB',
    wrappedNativeSymbol: 'WBNB',
    wrappedNativeAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    stableSymbols: ['USDT', 'USDC'],
    defaultProtocolOrder: ['pancakeswap-v2', 'pancakeswap-v3', 'uniswap-v4', 'uniswap-v3'],
    protocols: [
      {
        id: 'uniswap-v4',
        label: 'Uniswap V4',
        dexName: 'Uniswap',
        version: 'v4',
        enabled: true,
        universalRouterAddress: '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
        wrappedNativeSymbol: 'WBNB',
        stableSymbols: ['USDT', 'USDC'],
        quoteMode: 'unsupported',
        executeMode: 'unsupported',
      },
      {
        id: 'uniswap-v3',
        label: 'Uniswap V3',
        dexName: 'Uniswap',
        version: 'v3',
        enabled: true,
        routerAddress: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
        quoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        universalRouterAddress: '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
        wrappedNativeSymbol: 'WBNB',
        stableSymbols: ['USDT', 'USDC'],
        feeTiers: [100, 500, 2500, 10000],
        quoteMode: 'v3',
        executeMode: 'v3',
      },
      {
        id: 'uniswap-v2',
        label: 'Uniswap V2',
        dexName: 'Uniswap',
        version: 'v2',
        enabled: false,
        routerAddress: undefined,
        wrappedNativeSymbol: 'WBNB',
        stableSymbols: ['USDT', 'USDC'],
        quoteMode: 'unsupported',
        executeMode: 'unsupported',
      },
      {
        id: 'pancakeswap-v3',
        label: 'PancakeSwap V3',
        dexName: 'PancakeSwap',
        version: 'v3',
        enabled: true,
        routerAddress: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
        quoterAddress: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
        universalRouterAddress: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
        wrappedNativeSymbol: 'WBNB',
        stableSymbols: ['USDT', 'USDC'],
        feeTiers: [100, 500, 2500, 10000],
        quoteMode: 'v3',
        executeMode: 'v3',
      },
      {
        id: 'pancakeswap-v2',
        label: 'PancakeSwap V2',
        dexName: 'PancakeSwap',
        version: 'v2',
        enabled: true,
        routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        wrappedNativeSymbol: 'WBNB',
        stableSymbols: ['USDT', 'USDC'],
        quoteMode: 'v2',
        executeMode: 'v2',
      },
    ],
  },
}

export function isSupportedSwapNetwork(network: Network): network is SupportedSwapNetwork {
  return SUPPORTED_SWAP_NETWORKS.includes(network as SupportedSwapNetwork)
}

export function getProtocolConfig(network: SupportedSwapNetwork, protocolId: DexProtocolId) {
  return EVM_CHAIN_CONFIG[network].protocols.find((protocol) => protocol.id === protocolId) ?? null
}
