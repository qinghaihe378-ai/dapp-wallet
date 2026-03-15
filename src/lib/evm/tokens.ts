import type { SupportedSwapNetwork } from './config'

export interface EvmToken {
  symbol: string
  name: string
  address: string
  decimals: number
  isNative: boolean
  wrappedAddress?: string
  tone: string
  priceUsd?: number
}

const TOKENS: Record<SupportedSwapNetwork, EvmToken[]> = {
  mainnet: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      isNative: true,
      wrappedAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tone: 'mainnet',
      priceUsd: 3000,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      decimals: 18,
      isNative: false,
      tone: 'slate',
      priceUsd: 3000,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      isNative: false,
      tone: 'usdc',
      priceUsd: 1,
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
      isNative: false,
      tone: 'emerald',
      priceUsd: 1,
    },
    {
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      decimals: 8,
      isNative: false,
      tone: 'gold',
      priceUsd: 70939.5,
    },
  ],
  base: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      isNative: true,
      wrappedAddress: '0x4200000000000000000000000000000000000006',
      tone: 'base',
      priceUsd: 3000,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
      isNative: false,
      tone: 'slate',
      priceUsd: 3000,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      decimals: 6,
      isNative: false,
      tone: 'usdc',
      priceUsd: 1,
    },
    {
      symbol: 'USDbC',
      name: 'USD Base Coin',
      address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca',
      decimals: 6,
      isNative: false,
      tone: 'emerald',
      priceUsd: 1,
    },
    {
      symbol: 'cbBTC',
      name: 'Coinbase Wrapped BTC',
      address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      decimals: 8,
      isNative: false,
      tone: 'gold',
      priceUsd: 70939.5,
    },
  ],
  bsc: [
    {
      symbol: 'BNB',
      name: 'BNB',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      isNative: true,
      wrappedAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      tone: 'bsc',
      priceUsd: 620,
    },
    {
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      decimals: 18,
      isNative: false,
      tone: 'slate',
      priceUsd: 620,
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x55d398326f99059ff775485246999027b3197955',
      decimals: 18,
      isNative: false,
      tone: 'emerald',
      priceUsd: 1,
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      decimals: 18,
      isNative: false,
      tone: 'usdc',
      priceUsd: 1,
    },
    {
      symbol: 'CAKE',
      name: 'PancakeSwap',
      address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      decimals: 18,
      isNative: false,
      tone: 'gold',
      priceUsd: 3.2,
    },
  ],
}

export function getSwapTokens(network: SupportedSwapNetwork) {
  return TOKENS[network]
}

export function getTokenBySymbol(network: SupportedSwapNetwork, symbol: string) {
  return TOKENS[network].find((token) => token.symbol === symbol) ?? null
}

export function getTokenByAddress(network: SupportedSwapNetwork, address: string) {
  return TOKENS[network].find((token) => token.address.toLowerCase() === address.toLowerCase()) ?? null
}

export function getWalletTrackedTokens(network: SupportedSwapNetwork) {
  return TOKENS[network].filter((token) => !token.isNative)
}

export function toWrappedTokenAddress(token: EvmToken): string {
  return token.isNative ? token.wrappedAddress ?? token.address : token.address
}
