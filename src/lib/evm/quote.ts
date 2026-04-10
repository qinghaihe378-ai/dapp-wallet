import { ethers } from 'ethers'
import { fetchTokenPools } from '../../api/geckoterminal'
import { fetchUniswapQuote, getLastUniswapApiError, hasUniswapApiKey, type UniswapApiQuote } from '../../api/uniswapTrade'
import { V2_ROUTER_ABI, V3_QUOTER_ABI } from './abis'
import { EVM_CHAIN_CONFIG, type DexProtocolConfig, type DexProtocolId, type SupportedSwapNetwork } from './config'
import { formatDisplayAmount } from './format'
import { minimumOutFromQuoted } from './slippage'
import type { EvmToken } from './tokens'
import { getSwapTokens, toWrappedTokenAddress } from './tokens'

const QUOTE_TTL_MS = 20_000
const NATIVE_PRICE_USD: Record<SupportedSwapNetwork, number> = {
  mainnet: 3000,
  base: 3000,
  bsc: 620,
}

export interface QuoteRequest {
  provider: ethers.Provider
  network: SupportedSwapNetwork
  fromToken: EvmToken
  toToken: EvmToken
  amountIn: string
  slippagePercent: number
  /** 用户钱包地址，用于 Uniswap API（Base V4）报价 */
  swapperAddress?: string
  /** 为 true 时尝试经稳定币等更多路径（适合 BSC 等链上仅稳定币池的代币） */
  useExtendedPaths?: boolean
}

interface CandidatePath {
  addresses: string[]
  symbols: string[]
  tokens: EvmToken[]
}

export interface LiveQuote {
  protocolId: DexProtocolId
  protocolLabel: string
  routerAddress: string
  quoteMode: 'v2' | 'v3' | 'api'
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
  /** Uniswap API 报价数据，仅当 quoteMode === 'api' 时存在 */
  _api?: { quote: unknown; routing: string; permitData: unknown; requestId: string }
}

/** 秒级报价：仅尝试直连 + 经 WETH，减少 RPC 调用 */
const FAST_PATH_LIMIT = 2

function getPathCandidates(network: SupportedSwapNetwork, fromToken: EvmToken, toToken: EvmToken, fast = true): CandidatePath[] {
  const chain = EVM_CHAIN_CONFIG[network]
  const tokenList = getSwapTokens(network)
  const tokensBySymbol = new Map(
    tokenList.map((token) => [token.symbol, token]),
  )
  const wrappedAddress = chain.wrappedNativeAddress

  const stableCandidates = chain.stableSymbols
    .filter((symbol) => symbol !== fromToken.symbol && symbol !== toToken.symbol)
    .map((symbol) => {
      const token = tokensBySymbol.get(symbol)
      return token ?? null
    })
    .filter(Boolean) as EvmToken[]

  const candidates: CandidatePath[] = []
  const directTokens = [fromToken, toToken]
  candidates.push({
    addresses: directTokens.map(toWrappedTokenAddress),
    symbols: directTokens.map((token) => token.symbol),
    tokens: directTokens,
  })

  if (toWrappedTokenAddress(fromToken) !== wrappedAddress && toWrappedTokenAddress(toToken) !== wrappedAddress) {
    candidates.push({
      addresses: [toWrappedTokenAddress(fromToken), wrappedAddress, toWrappedTokenAddress(toToken)],
      symbols: [fromToken.symbol, chain.wrappedNativeSymbol, toToken.symbol],
      tokens: [
        fromToken,
        {
          symbol: chain.wrappedNativeSymbol,
          name: chain.wrappedNativeSymbol,
          address: wrappedAddress,
          decimals: 18,
          isNative: false,
          tone: 'slate',
        },
        toToken,
      ],
    })
  }

  if (!fast) {
    for (const stableToken of stableCandidates) {
      candidates.push({
        addresses: [toWrappedTokenAddress(fromToken), stableToken.address, toWrappedTokenAddress(toToken)],
        symbols: [fromToken.symbol, stableToken.symbol, toToken.symbol],
        tokens: [fromToken, stableToken, toToken],
      })
    }
  }

  const filtered = candidates.filter((path, index, list) => {
    const key = path.addresses.join(':')
    return path.addresses[0] !== path.addresses[path.addresses.length - 1] && list.findIndex((item) => item.addresses.join(':') === key) === index
  })
  return fast ? filtered.slice(0, FAST_PATH_LIMIT) : filtered
}

/** 常用 fee tiers（含 2500 以支持 BSC PancakeSwap V3 常见 0.25% 池） */
const FAST_FEE_TIERS = [500, 2500, 3000]

function buildFeeVariants(length: number, feeTiers: number[], fast = true) {
  const tiers = fast ? FAST_FEE_TIERS : feeTiers
  if (length <= 1) return [[]]
  let variants: number[][] = [[]]
  for (let index = 0; index < length - 1; index += 1) {
    variants = variants.flatMap((variant) => tiers.map((fee) => [...variant, fee]))
  }
  return variants
}

async function quoteV2Path(
  provider: ethers.Provider,
  protocol: DexProtocolConfig,
  amountInWei: bigint,
  path: CandidatePath,
) {
  if (!protocol.routerAddress) {
    return null
  }

  const router = new ethers.Contract(protocol.routerAddress, V2_ROUTER_ABI, provider)
  const amounts = await router.getAmountsOut(amountInWei, path.addresses) as bigint[]
  return {
    amountOutWei: amounts[amounts.length - 1],
    pathFees: [] as number[],
    gasEstimate: 220000n,
  }
}

async function quoteV3SingleHop(
  quoter: ethers.Contract,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number,
): Promise<[bigint, bigint] | null> {
  try {
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    }) as [bigint, bigint, number, bigint]
    return [result[0], result[3]]
  } catch {
    return null
  }
}

async function quoteV3Path(
  provider: ethers.Provider,
  protocol: DexProtocolConfig,
  amountInWei: bigint,
  path: CandidatePath,
  useFullFeeTiers = false,
) {
  if (!protocol.quoterAddress || !protocol.feeTiers?.length) {
    return null
  }

  const quoter = new ethers.Contract(protocol.quoterAddress, V3_QUOTER_ABI, provider)
  const feeVariants = buildFeeVariants(path.addresses.length, protocol.feeTiers, !useFullFeeTiers)

  const results = await Promise.all(
    feeVariants.map(async (fees) => {
      let currentAmount = amountInWei
      let totalGas = 0n
      for (let index = 0; index < path.addresses.length - 1; index += 1) {
        const hop = await quoteV3SingleHop(
          quoter,
          path.addresses[index],
          path.addresses[index + 1],
          currentAmount,
          fees[index],
        )
        if (!hop) return null
        ;[currentAmount, totalGas] = [hop[0], totalGas + hop[1]]
      }
      return { amountOutWei: currentAmount, pathFees: fees, gasEstimate: totalGas > 0n ? totalGas : null }
    }),
  )

  const valid = results.filter((r): r is NonNullable<typeof r> => r != null)
  if (valid.length === 0) return null
  return valid.reduce((best, r) => (r.amountOutWei > best.amountOutWei ? r : best), valid[0])
}

async function quoteByProtocol(
  request: QuoteRequest,
  protocol: DexProtocolConfig,
): Promise<LiveQuote | null> {
  if (!protocol.enabled || protocol.quoteMode === 'unsupported' || !protocol.routerAddress) {
    return null
  }

  const amountInWei = ethers.parseUnits(request.amountIn, request.fromToken.decimals)
  if (amountInWei <= 0n) {
    return null
  }

  const fast = request.useExtendedPaths !== true
  const candidates = getPathCandidates(request.network, request.fromToken, request.toToken, fast)
  const useFullFeeTiers = request.useExtendedPaths === true
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const quoted =
          protocol.quoteMode === 'v2'
            ? await quoteV2Path(request.provider, protocol, amountInWei, candidate)
            : await quoteV3Path(request.provider, protocol, amountInWei, candidate, useFullFeeTiers)
        return quoted ? { ...quoted, candidate } : null
      } catch {
        return null
      }
    }),
  )
  type Quoted = { amountOutWei: bigint; pathFees: number[]; gasEstimate: bigint | null; candidate: CandidatePath }
  const best = results
    .filter((r): r is Quoted => r != null)
    .reduce<Quoted | null>((acc, r) => (acc == null || r.amountOutWei > acc.amountOutWei ? r : acc), null)

  if (!best) {
    return null
  }

  const minimumAmountOutWei = minimumOutFromQuoted(best.amountOutWei, request.slippagePercent)
  const gasEstimateUsd =
    best.gasEstimate != null
      ? Number(ethers.formatEther(best.gasEstimate)) * NATIVE_PRICE_USD[request.network]
      : null

  return {
    protocolId: protocol.id,
    protocolLabel: protocol.label,
    routerAddress: protocol.routerAddress,
    quoteMode: protocol.quoteMode,
    amountInWei,
    amountOutWei: best.amountOutWei,
    minimumAmountOutWei,
    amountInDisplay: formatDisplayAmount(amountInWei, request.fromToken.decimals),
    estimatedOut: formatDisplayAmount(best.amountOutWei, request.toToken.decimals),
    minimumReceived: formatDisplayAmount(minimumAmountOutWei, request.toToken.decimals),
    routeSymbols: best.candidate.symbols,
    routeLabel: `${best.candidate.symbols.join(' > ')} · ${protocol.label}`,
    pathAddresses: best.candidate.addresses,
    pathFees: best.pathFees,
    tokenIn: request.fromToken,
    tokenOut: request.toToken,
    gasEstimate: best.gasEstimate,
    gasEstimateUsd,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  }
}

/** GeckoTerminal dexId 到协议 ID 映射 */
const DEX_TO_PROTOCOL: Record<string, DexProtocolId> = {
  'uniswap-v3-base': 'uniswap-v3',
  'uniswap-v3-eth': 'uniswap-v3',
  'uniswap-v2-base': 'uniswap-v2',
  'uniswap-v2-eth': 'uniswap-v2',
  'aerodrome-v2': 'aerodrome-v2',
  'aerodrome-base': 'aerodrome-v2',
  'aerodrome-slipstream-2': 'aerodrome-v2',
  'pancakeswap-v3-base': 'pancakeswap-v3',
  'pancakeswap-v2-base': 'pancakeswap-v2',
}

/** 从 GeckoTerminal 池子发现路由并报价（API 与常规路径均失败时的备选） */
async function quoteFromGeckoPools(request: QuoteRequest): Promise<LiveQuote | null> {
  const toAddr = request.toToken.address.toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(toAddr)) return null

  const pools = await fetchTokenPools(request.network, toAddr)
  if (pools.length === 0) return null

  const chain = EVM_CHAIN_CONFIG[request.network]
  const wrappedAddr = chain.wrappedNativeAddress.toLowerCase()
  const nativeAddr = '0x0000000000000000000000000000000000000000'

  const amountWei = ethers.parseUnits(request.amountIn, request.fromToken.decimals)
  if (amountWei <= 0n) return null

  const matchingPools = pools.filter((p) => {
    const hasFrom = p.baseTokenAddress === wrappedAddr || p.quoteTokenAddress === wrappedAddr || p.baseTokenAddress === nativeAddr || p.quoteTokenAddress === nativeAddr
    const hasTo = p.baseTokenAddress === toAddr || p.quoteTokenAddress === toAddr
    return hasFrom && hasTo
  })

  let best: LiveQuote | null = null

  for (const pool of matchingPools) {
    const protocolId = DEX_TO_PROTOCOL[pool.dexId]
    if (!protocolId) continue

    const protocol = chain.protocols.find((p) => p.id === protocolId)
    if (!protocol?.enabled || !protocol.routerAddress) continue

    const tokenInAddr = pool.baseTokenAddress === toAddr ? pool.quoteTokenAddress : pool.baseTokenAddress
    const tokenOutAddr = pool.baseTokenAddress === toAddr ? pool.baseTokenAddress : pool.quoteTokenAddress

    if (tokenInAddr === nativeAddr) continue

    let addrIn: string
    let addrOut: string
    try {
      addrIn = ethers.getAddress(tokenInAddr)
      addrOut = ethers.getAddress(tokenOutAddr)
    } catch {
      continue
    }

    const path: CandidatePath = {
      addresses: [addrIn, addrOut],
      symbols: [request.fromToken.symbol, request.toToken.symbol],
      tokens: [request.fromToken, request.toToken],
    }

    try {
      let quoted: { amountOutWei: bigint; pathFees: number[]; gasEstimate: bigint | null } | null = null
      if (protocol.quoteMode === 'v2') {
        quoted = await quoteV2Path(request.provider, protocol, amountWei, path)
      } else if (protocol.quoteMode === 'v3' && protocol.quoterAddress) {
        if (pool.feeBps != null) {
          quoted = await quoteV3PathWithFees(request.provider, protocol, amountWei, path, [pool.feeBps])
        }
        if (!quoted) {
          quoted = await quoteV3Path(request.provider, protocol, amountWei, path, true)
        }
      }
      if (!quoted) continue

      const minimumAmountOutWei = minimumOutFromQuoted(quoted.amountOutWei, request.slippagePercent)

      const live: LiveQuote = {
        protocolId: protocol.id,
        protocolLabel: protocol.label,
        routerAddress: protocol.routerAddress,
        quoteMode: protocol.quoteMode === 'unsupported' ? 'v3' : protocol.quoteMode,
        amountInWei: amountWei,
        amountOutWei: quoted.amountOutWei,
        minimumAmountOutWei,
        amountInDisplay: formatDisplayAmount(amountWei, request.fromToken.decimals),
        estimatedOut: formatDisplayAmount(quoted.amountOutWei, request.toToken.decimals),
        minimumReceived: formatDisplayAmount(minimumAmountOutWei, request.toToken.decimals),
        routeSymbols: [request.fromToken.symbol, request.toToken.symbol],
        routeLabel: `${pool.poolName} · ${protocol.label}`,
        pathAddresses: path.addresses,
        pathFees: quoted.pathFees,
        tokenIn: request.fromToken,
        tokenOut: request.toToken,
        gasEstimate: quoted.gasEstimate,
        gasEstimateUsd: null,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      }
      if (!best || live.amountOutWei > best.amountOutWei) best = live
    } catch {
      continue
    }
  }
  return best
}

/** 指定 fee 列表的 V3 报价 */
async function quoteV3PathWithFees(
  provider: ethers.Provider,
  protocol: DexProtocolConfig,
  amountInWei: bigint,
  path: CandidatePath,
  fees: number[],
): Promise<{ amountOutWei: bigint; pathFees: number[]; gasEstimate: bigint | null } | null> {
  if (!protocol.quoterAddress || path.addresses.length < 2) return null
  const quoter = new ethers.Contract(protocol.quoterAddress, V3_QUOTER_ABI, provider)
  const feeVariants = path.addresses.length === 2 ? fees.map((f) => [f]) : []
  if (feeVariants.length === 0) return null

  const results = await Promise.all(
    feeVariants.map(async (feeList) => {
      let currentAmount = amountInWei
      let totalGas = 0n
      for (let i = 0; i < path.addresses.length - 1; i++) {
        const hop = await quoteV3SingleHop(quoter, path.addresses[i], path.addresses[i + 1], currentAmount, feeList[i])
        if (!hop) return null
        ;[currentAmount, totalGas] = [hop[0], totalGas + hop[1]]
      }
      return { amountOutWei: currentAmount, pathFees: feeList, gasEstimate: totalGas > 0n ? totalGas : null }
    }),
  )
  const valid = results.filter((r): r is NonNullable<typeof r> => r != null)
  if (valid.length === 0) return null
  return valid.reduce((best, r) => (r.amountOutWei > best.amountOutWei ? r : best), valid[0])
}

/** 自动选择最优路由：并行请求所有可用协议，返回输出最多的报价 */
export async function getBestLiveQuote(request: QuoteRequest) {
  const chain = EVM_CHAIN_CONFIG[request.network]
  const protocolsToTry = chain.protocols.filter(
    (p) => p.enabled && p.quoteMode !== 'unsupported' && p.routerAddress,
  )
  const order = new Map(chain.defaultProtocolOrder.map((id, i) => [id, i]))
  const sorted = [...protocolsToTry].sort(
    (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99),
  )

  const swapper = request.swapperAddress
  const tryUniswapApi =
    (request.network === 'base' || request.network === 'mainnet') &&
    swapper &&
    chain.protocols.some((p) => p.id === 'uniswap-v4')

  const [apiQuote, ...onChainQuotes] = await Promise.all([
    tryUniswapApi && swapper
      ? fetchUniswapQuote({
          network: request.network,
          fromToken: request.fromToken,
          toToken: request.toToken,
          amountIn: request.amountIn,
          slippagePercent: request.slippagePercent,
          swapperAddress: swapper,
        })
      : Promise.resolve(null),
    ...sorted.map((protocol) => quoteByProtocol(request, protocol)),
  ])

  let quotes: LiveQuote[] = [
    ...(apiQuote ? [toLiveQuote(apiQuote, request.network)] : []),
    ...onChainQuotes.filter(Boolean),
  ] as LiveQuote[]

  if (quotes.length === 0 && request.useExtendedPaths !== true) {
    const retryRequest = { ...request, useExtendedPaths: true }
    const retryQuotes = await Promise.all(
      sorted.map((protocol) => quoteByProtocol(retryRequest, protocol)),
    )
    quotes = retryQuotes.filter(Boolean) as LiveQuote[]
  }

  if (quotes.length === 0) {
    const geckoQuote = await quoteFromGeckoPools(request)
    if (geckoQuote) quotes = [geckoQuote]
  }

  if (quotes.length === 0) {
    const hint =
      request.network === 'bsc'
        ? '当前网络下没有可用的真实报价，请确认代币在 PancakeSwap 有流动性或稍后重试。'
        : request.network === 'base'
          ? (() => {
              const apiErr = getLastUniswapApiError()
              const baseHint = hasUniswapApiKey()
                ? '未找到报价。代币若仅在 Uniswap V4 有池子，需能访问 Uniswap API；国内请尝试 VPN。'
                : '未找到报价。代币若仅在 Uniswap V4 有池子，请在个人中心配置 API Key 并保存。'
              return apiErr ? `${baseHint} [API: ${apiErr}]` : baseHint
            })()
          : '当前网络下没有可用的真实报价。'
    throw new Error(hint)
  }

  // BSC 卖出（token -> 其他）时，税费币更适配 Pancake V2；
  // V3 报价可能更高，但执行时因 transfer tax 导致回退。
  if (request.network === 'bsc' && !request.fromToken.isNative) {
    const v2Preferred = quotes.find((q) => q.protocolId === 'pancakeswap-v2')
    if (v2Preferred) return v2Preferred
  }

  return quotes.sort((left, right) => {
    if (right.amountOutWei > left.amountOutWei) return 1
    if (right.amountOutWei < left.amountOutWei) return -1
    return 0
  })[0]
}

function toLiveQuote(api: UniswapApiQuote, network: SupportedSwapNetwork): LiveQuote {
  const chain = EVM_CHAIN_CONFIG[network]
  const universalRouter = chain.protocols.find((p) => p.id === 'uniswap-v4')?.universalRouterAddress ?? ''
  return {
    protocolId: api.protocolId,
    protocolLabel: api.protocolLabel,
    routerAddress: universalRouter,
    quoteMode: 'api',
    amountInWei: api.amountInWei,
    amountOutWei: api.amountOutWei,
    minimumAmountOutWei: api.minimumAmountOutWei,
    amountInDisplay: api.amountInDisplay,
    estimatedOut: api.estimatedOut,
    minimumReceived: api.minimumReceived,
    routeSymbols: api.routeSymbols,
    routeLabel: api.routeLabel,
    pathAddresses: api.pathAddresses,
    pathFees: api.pathFees,
    tokenIn: api.tokenIn,
    tokenOut: api.tokenOut,
    gasEstimate: api.gasEstimate,
    gasEstimateUsd: api.gasEstimateUsd,
    expiresAt: api.expiresAt,
    _api: api._api,
  }
}
