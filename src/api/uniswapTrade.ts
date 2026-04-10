/**
 * Uniswap Trading API - 支持 V2/V3/V4 路由（含 Base 链 Clanker 等 V4 池子）
 * 文档: https://api-docs.uniswap.org
 */

import { ethers } from 'ethers'
import { formatDisplayAmount } from '../lib/evm/format'
import { minimumOutFromQuoted } from '../lib/evm/slippage'
import type { SupportedSwapNetwork } from '../lib/evm/config'
import type { EvmToken } from '../lib/evm/tokens'

/** 是否使用代理（避免 CORS、保护 API Key） */
const USE_PROXY =
  import.meta.env.VITE_UNISWAP_USE_PROXY === 'true' ||
  (import.meta.env.DEV && !import.meta.env.VITE_UNISWAP_API_PROXY?.trim())

const API_BASE = USE_PROXY
  ? '/api/uniswap'
  : import.meta.env.VITE_UNISWAP_API_PROXY?.trim() || 'https://trade-api.gateway.uniswap.org/v1'

const NETWORK_TO_CHAIN_ID: Record<SupportedSwapNetwork, number> = {
  mainnet: 1,
  base: 8453,
  bsc: 56,
}

/** Uniswap API 支持的链（mainnet、base 等） */
const UNISWAP_API_CHAINS = new Set([1, 8453])

const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000'

/** 应用内配置的 Uniswap API Key 存于此 key（个人中心可配置 Base Uniswap V4） */
export const UNISWAP_API_KEY_STORAGE_KEY = 'uniswapApiKey'

function getApiKey(): string | undefined {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(UNISWAP_API_KEY_STORAGE_KEY)?.trim()
    if (stored) return stored
  }
  return import.meta.env.VITE_UNISWAP_API_KEY
}

/** 是否已配置 Uniswap API Key 或使用代理（用于 Base V4 报价） */
export function hasUniswapApiKey(): boolean {
  return USE_PROXY || !!getApiKey()
}

/** 上次 API 失败原因，用于错误提示 */
let lastUniswapApiError: string | null = null
export function getLastUniswapApiError(): string | null {
  return lastUniswapApiError
}

function toTokenAddress(token: EvmToken): string {
  if (token.isNative) return NATIVE_ADDRESS
  try {
    return ethers.getAddress(token.address)
  } catch {
    return token.address
  }
}

export interface UniswapApiQuoteInput {
  network: SupportedSwapNetwork
  fromToken: EvmToken
  toToken: EvmToken
  amountIn: string
  slippagePercent: number
  swapperAddress: string
}

export interface ClassicQuoteRoute {
  type: 'v2-pool' | 'v3-pool' | 'v4-pool'
  address?: string
  tokenIn?: { address: string; symbol: string }
  tokenOut?: { address: string; symbol: string }
  amountIn?: string
  amountOut?: string
}

export interface UniswapApiQuote {
  protocolId: 'uniswap-v4'
  protocolLabel: string
  quoteMode: 'api'
  amountInWei: bigint
  amountOutWei: bigint
  minimumAmountOutWei: bigint
  amountInDisplay: string
  estimatedOut: string
  minimumReceived: string
  routeSymbols: string[]
  routeLabel: string
  pathAddresses: string[]
  pathFees: number[]
  tokenIn: EvmToken
  tokenOut: EvmToken
  gasEstimate: bigint | null
  gasEstimateUsd: number | null
  expiresAt: number
  /** 用于执行 swap 的 API 数据 */
  _api: {
    quote: unknown
    routing: string
    permitData: unknown
    requestId: string
  }
}

interface ApiQuoteResponse {
  quote: {
    input: { token: string; amount: string }
    output: { token: string; amount: string; recipient?: string }
    route?: ClassicQuoteRoute[][]
    routeString?: string
    chainId: number
    slippage?: number
    gasFee?: string
    gasFeeUSD?: string
    gasUseEstimate?: string
  }
  routing: string
  permitData: unknown
  requestId: string
}

interface ApiSwapResponse {
  swap: {
    to: string
    from: string
    data: string
    value: string
    chainId: number
    gasLimit?: string
    maxFeePerGas?: string
    maxPriorityFeePerGas?: string
    gasPrice?: string
  }
}

/** 从 Uniswap API 获取报价（支持 V4） */
export async function fetchUniswapQuote(
  input: UniswapApiQuoteInput,
): Promise<UniswapApiQuote | null> {
  const apiKey = getApiKey()
  if (!USE_PROXY && !apiKey) return null

  const chainId = NETWORK_TO_CHAIN_ID[input.network]
  if (!UNISWAP_API_CHAINS.has(chainId)) return null

  const tokenIn = toTokenAddress(input.fromToken)
  const tokenOut = toTokenAddress(input.toToken)
  const amountWei = ethers.parseUnits(input.amountIn, input.fromToken.decimals)
  if (amountWei <= 0n) return null

  let swapper: string
  try {
    swapper = ethers.getAddress(input.swapperAddress)
  } catch {
    lastUniswapApiError = 'swapper 地址格式无效'
    return null
  }

  const body = {
    type: 'EXACT_INPUT' as const,
    amount: amountWei.toString(),
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn,
    tokenOut,
    swapper,
    autoSlippage: 'DEFAULT' as const,
    routingPreference: 'BEST_PRICE' as const,
    protocols: ['V4', 'V3', 'V2'] as const,
    hooksOptions: 'V4_HOOKS_INCLUSIVE' as const,
    generatePermitAsTransaction: false,
    spreadOptimization: 'EXECUTION' as const,
    urgency: 'urgent' as const,
    permitAmount: 'FULL' as const,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (!USE_PROXY && apiKey) {
    headers['x-api-key'] = apiKey
    headers['x-universal-router-version'] = '2.0'
    headers['x-permit2-disabled'] = 'true'
  }

  const fetchOpts = {
    method: 'POST' as const,
    headers,
    body: JSON.stringify(body),
  }
  const doFetch = () => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    return fetch(`${API_BASE}/quote`, { ...fetchOpts, signal: ctrl.signal }).finally(() => clearTimeout(t))
  }
  let res: Response
  try {
    res = await doFetch()
  } catch (e) {
    try {
      res = await doFetch()
    } catch (e2) {
      lastUniswapApiError = `网络错误: ${e instanceof Error ? e.message : String(e)}`
      console.warn('[Uniswap API] network error:', e)
      return null
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = typeof err?.detail === 'string' ? err.detail : err?.message ?? JSON.stringify(err).slice(0, 100)
    lastUniswapApiError = `API ${res.status}: ${msg}`
    console.warn('[Uniswap API] quote failed:', res.status, err)
    return null
  }

  let data: ApiQuoteResponse
  try {
    data = (await res.json()) as ApiQuoteResponse
  } catch (e) {
    lastUniswapApiError = `解析失败: ${e instanceof Error ? e.message : String(e)}`
    console.warn('[Uniswap API] parse error:', e)
    return null
  }

  if ((data.routing || '').toUpperCase() !== 'CLASSIC') {
    lastUniswapApiError = `API 返回 routing=${data.routing ?? 'null'}，非 CLASSIC`
    return null
  }
  lastUniswapApiError = null

  const q = data.quote
  const outAmount = q?.output?.amount
  if (!outAmount) {
    lastUniswapApiError = 'API 返回无 output.amount'
    return null
  }
  const amountOutWei = BigInt(outAmount)
  // autoSlippage 时 API 可能返回 q.slippage（百分比），否则用用户配置
  const slippagePercent = q.slippage ?? input.slippagePercent
  const minimumAmountOutWei = minimumOutFromQuoted(amountOutWei, slippagePercent)

  const routeSymbols: string[] = []
  const pathAddresses: string[] = []
  const pathFees: number[] = []

  if (q.route && q.route.length > 0) {
    const hops = q.route[0]
    for (let i = 0; i < hops.length; i += 1) {
      const hop = hops[i]
      if (i === 0 && hop.tokenIn?.address) {
        pathAddresses.push(hop.tokenIn.address)
      }
      if (hop.tokenOut?.address) {
        pathAddresses.push(hop.tokenOut.address)
      }
      if (hop.tokenIn?.symbol && !routeSymbols.includes(hop.tokenIn.symbol)) {
        routeSymbols.push(hop.tokenIn.symbol)
      }
      if (hop.tokenOut?.symbol && !routeSymbols.includes(hop.tokenOut.symbol)) {
        routeSymbols.push(hop.tokenOut.symbol)
      }
      if ('fee' in hop && typeof (hop as { fee?: number }).fee === 'number') {
        pathFees.push((hop as { fee: number }).fee)
      }
    }
  }
  if (routeSymbols.length === 0) {
    routeSymbols.push(input.fromToken.symbol, input.toToken.symbol)
  }
  if (pathAddresses.length === 0) {
    pathAddresses.push(tokenIn, tokenOut)
  }

  const gasEstimate = q.gasUseEstimate ? BigInt(q.gasUseEstimate) : null
  const gasEstimateUsd = q.gasFeeUSD ? parseFloat(q.gasFeeUSD) : null

  const QUOTE_TTL_MS = 20_000

  return {
    protocolId: 'uniswap-v4',
    protocolLabel: 'Uniswap V4',
    quoteMode: 'api',
    amountInWei: amountWei,
    amountOutWei,
    minimumAmountOutWei,
    amountInDisplay: formatDisplayAmount(amountWei, input.fromToken.decimals),
    estimatedOut: formatDisplayAmount(amountOutWei, input.toToken.decimals),
    minimumReceived: formatDisplayAmount(minimumAmountOutWei, input.toToken.decimals),
    routeSymbols,
    routeLabel: q.routeString ?? `${routeSymbols.join(' > ')} · Uniswap V4`,
    pathAddresses,
    pathFees,
    tokenIn: input.fromToken,
    tokenOut: input.toToken,
    gasEstimate,
    gasEstimateUsd,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    _api: {
      quote: data.quote,
      routing: data.routing,
      permitData: data.permitData,
      requestId: data.requestId,
    },
  }
}

/** 从 Uniswap API 获取可广播的交易 */
export async function fetchUniswapSwapTransaction(
  apiQuote: Pick<UniswapApiQuote, '_api'>,
): Promise<{ to: string; from: string; data: string; value: string; chainId: number; gasLimit?: string }> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Uniswap API key not configured')

  const body: { quote: unknown; signature?: string; permitData?: unknown } = {
    quote: apiQuote._api.quote,
  }
  if (apiQuote._api.permitData) {
    throw new Error('Permit2 签名暂未实现，请使用 x-permit2-disabled 模式')
  }

  const res = await fetch(`${API_BASE}/swap`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-universal-router-version': '2.0',
      'x-permit2-disabled': 'true',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Uniswap swap 请求失败: ${res.status} ${JSON.stringify(err)}`)
  }

  const data = (await res.json()) as ApiSwapResponse
  const swap = data.swap
  if (!swap?.data || swap.data === '0x') {
    throw new Error('Uniswap API 返回的交易 data 为空')
  }
  return swap
}
