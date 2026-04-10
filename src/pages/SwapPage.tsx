import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { useSearchParams } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { usePrices } from '../hooks/usePrices'
import { NETWORK_CONFIG, type Network } from '../lib/walletConfig'
import { fetchEvmTokenByAddress, readTokenBalance } from '../lib/evm/balances'
import { executeQuotedSwap } from '../lib/evm/executeSwap'
import { isSupportedSwapNetwork, type SupportedSwapNetwork } from '../lib/evm/config'
import { getBestLiveQuote, type LiveQuote } from '../lib/evm/quote'
import { getSwapTokens, type EvmToken } from '../lib/evm/tokens'
import { parseEvmAddressInput } from '../api/jupiter'
import { usePageConfig } from '../hooks/usePageConfig'
import { dexMarketIdToTokenAddress, searchSwapPickerMarketItems } from '../api/markets'

interface SwapHistoryItem {
  id: string
  fromSymbol: string
  toSymbol: string
  amountIn: string
  estimatedOut: string
  network: string
  status: 'pending' | 'success' | 'failed'
  protocol?: string
  stage?: 'approving' | 'swapping'
  approveHash?: string | null
  txHash?: string
  timestamp: number
}

type HistoryFilter = 'all' | 'pending' | 'success' | 'failed'

type SwapToken = EvmToken

const QUICK_TRADE_PARAM_KEYS = ['from', 'to', 'fromAddr', 'toAddr', 'amount', 'chain'] as const

/** URL ?chain= 与行情跳转统一：mainnet|bsc|base|polygon（及常见别名） */
function parseSwapChainQuery(raw: string | null): Network | null {
  const k = (raw ?? '').trim().toLowerCase()
  if (!k) return null
  if (k === 'mainnet' || k === 'eth' || k === 'ethereum') return 'mainnet'
  if (k === 'bsc' || k === 'bnb') return 'bsc'
  if (k === 'base') return 'base'
  if (k === 'polygon' || k === 'matic') return 'polygon'
  return null
}

const PLACEHOLDER_EVM: EvmToken = {
  symbol: '--',
  name: 'Unsupported',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
  isNative: false,
  tone: 'slate',
}

/** 用于 localStorage 精确恢复（避免同名 symbol 歧义、自定义币不在默认列表） */
function swapTokenStorageKey(t: SwapToken): string {
  return t.address.toLowerCase()
}

const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'USDbC', 'DAI'])

/** 从 liveQuote 推导 USD 价值（路由隐含汇率，非预设） */
function deriveUsdFromQuote(
  amountIn: number,
  estimatedOut: number,
  fromSymbol: string,
  toSymbol: string,
): number | null {
  if (amountIn <= 0) return null
  if (STABLECOIN_SYMBOLS.has(toSymbol)) return estimatedOut
  if (STABLECOIN_SYMBOLS.has(fromSymbol)) return amountIn
  return null
}

/** 从 liveQuote 推导原生代币 USD 价（用于 gas 估算） */
function deriveNativePriceFromQuote(
  amountIn: number,
  estimatedOut: number,
  fromSymbol: string,
  toSymbol: string,
  nativeSymbol: string,
): number | null {
  if (amountIn <= 0) return null
  if (fromSymbol === nativeSymbol && STABLECOIN_SYMBOLS.has(toSymbol)) return estimatedOut / amountIn
  if (toSymbol === nativeSymbol && STABLECOIN_SYMBOLS.has(fromSymbol)) return amountIn / estimatedOut
  return null
}

function getQuoteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ACTION_REJECTED') || message.toLowerCase().includes('user rejected')) {
    return '你已取消签名。'
  }
  if (message.toLowerCase().includes('insufficient funds')) {
    return '余额不足或 gas 不足。'
  }
  if (message.toLowerCase().includes('expired')) {
    return '报价已过期，请重新获取报价。'
  }
  if (message.toLowerCase().includes('slippage') || message.toLowerCase().includes('too little received')) {
    return '触发滑点保护，请调高滑点或减小兑换数量。'
  }
  if (message.toLowerCase().includes('allowance')) {
    return '授权失败，请重新尝试。'
  }
  if (message.toLowerCase().includes('call_exception') || message.toLowerCase().includes('execution reverted')) {
    return '链上执行失败（常见于滑点过紧或成交前池价波动，卖出山寨币时更易发生）。请将滑点调至 3%～5%、减小单笔数量，或等待报价刷新后再试。'
  }
  if (message.toLowerCase().includes('no route') || message.toLowerCase().includes('insufficient liquidity')) {
    return '暂无可用路由或流动性不足。'
  }
  if (message === 'Failed to fetch' || message.toLowerCase().includes('failed to fetch')) {
    return '网络请求失败。EVM 链需能访问路由 API。国内可尝试 VPN 或配置 API Key。'
  }
  return '发起兑换失败，请检查网络、余额和滑点设置。'
}

function getPendingStageLabel(stage?: 'approving' | 'swapping', approveHash?: string | null) {
  if (stage === 'approving') {
    return approveHash ? '授权确认中' : '等待授权签名'
  }
  if (stage === 'swapping') {
    return '等待兑换确认'
  }
  return null
}

export function SwapPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { signer, address, network, balance, provider, refreshBalance, refreshNonce, switchNetwork } = useWallet()
  const { getPrice } = usePrices()
  const { config } = usePageConfig('swap')
  const swapSelectionKey = `swapSelection:${network}`
  const swapSlippageKey = `swapSlippage:${network}`
  const swapHistoryKey = `swapHistory:${network}`
  const swapHistoryFilterKey = `swapHistoryFilter:${network}`
  const [amountIn, setAmountIn] = useState('')
  const [loading, setLoading] = useState(false)
  const [approveBroadcastHash, setApproveBroadcastHash] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [customEvmTokens, setCustomEvmTokens] = useState<EvmToken[]>([])
  const [customTokenLoading, setCustomTokenLoading] = useState(false)
  /** DexScreener 与首页同源，按当前链过滤后的补全列表 */
  const [dexPickerTokens, setDexPickerTokens] = useState<EvmToken[]>([])
  const [dexPickerLoading, setDexPickerLoading] = useState(false)
  const [recentSymbols, setRecentSymbols] = useState<string[]>([])
  const [slippageOpen, setSlippageOpen] = useState(false)
  const [slippage, setSlippage] = useState('2')
  const [customSlippage, setCustomSlippage] = useState('2')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [riskConfirmOpen, setRiskConfirmOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState<SwapHistoryItem[]>([])
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null)
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteRefreshNonce, setQuoteRefreshNonce] = useState(0)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [executionStage, setExecutionStage] = useState<'approving' | 'swapping' | null>(null)
  const [fromTokenBalance, setFromTokenBalance] = useState<string | null>(null)
  const [toTokenBalance, setToTokenBalance] = useState<string | null>(null)

  const chainName = NETWORK_CONFIG[network].chainName
  const explorerTxBase = NETWORK_CONFIG[network].explorerTxBase
  const quoteSupported = isSupportedSwapNetwork(network)
  const tokenOptions = useMemo((): SwapToken[] => {
    return quoteSupported
      ? getSwapTokens(network as SupportedSwapNetwork)
      : []
  }, [network, quoteSupported])

  const readOnlyProvider = useMemo(() => {
    if (!isSupportedSwapNetwork(network)) return null
    return new ethers.JsonRpcProvider(NETWORK_CONFIG[network].rpcUrls[0])
  }, [network])

  /** 钱包未就绪时仍用公共 RPC 拉链上报价 */
  const swapQuoteProvider = provider ?? readOnlyProvider

  /** 默认：用当前链原生币买入；to 优先稳定币等非原生资产 */
  const defaultFrom = useMemo(
    () => tokenOptions.find((t) => t.isNative) ?? tokenOptions[0],
    [tokenOptions],
  )
  const defaultTo = useMemo(() => {
    if (!tokenOptions.length) return undefined
    const natAddr = tokenOptions.find((t) => t.isNative)?.address.toLowerCase()
    return (
      tokenOptions.find(
        (item) =>
          !item.isNative &&
          (item.symbol === 'USDC' || item.symbol === 'USDT' || item.symbol === 'USDbC'),
      ) ??
      tokenOptions.find((t) => !t.isNative && t.address.toLowerCase() !== natAddr) ??
      tokenOptions.find((t) => !t.isNative) ??
      tokenOptions[0]
    )
  }, [tokenOptions])
  const placeholder = PLACEHOLDER_EVM
  const [fromToken, setFromToken] = useState<SwapToken>(defaultFrom ?? placeholder)
  const [toToken, setToToken] = useState<SwapToken>(defaultTo ?? placeholder)

  const quickTradeKeysPresent = useMemo(
    () => QUICK_TRADE_PARAM_KEYS.some((key) => searchParams.has(key)),
    [searchParams],
  )

  const prevSwapSelectionKeyRef = useRef(swapSelectionKey)
  useEffect(() => {
    if (prevSwapSelectionKeyRef.current !== swapSelectionKey) {
      prevSwapSelectionKeyRef.current = swapSelectionKey
      setAmountIn('')
    }
  }, [swapSelectionKey])

  /** 仅在网络/内置列表变化时从 localStorage 恢复币对；勿依赖 customEvmTokens，否则选币向列表添加代币时会先于持久化 effect 读到旧存储，把「支付山寨币卖出」覆盖回默认原生买币。 */
  useEffect(() => {
    if (quickTradeKeysPresent) return
    const merged: SwapToken[] = [...tokenOptions, ...customEvmTokens]
    const stored = window.localStorage.getItem(swapSelectionKey)
    const parsed = stored
      ? (JSON.parse(stored) as { from?: string; to?: string; fromKey?: string; toKey?: string })
      : null

    const byKey = (key?: string | null) => {
      if (!key?.trim()) return null
      const k = key.trim().toLowerCase()
      return merged.find((item) => item.address.toLowerCase() === k) ?? null
    }
    const bySym = (sym?: string | null) => {
      if (!sym?.trim()) return null
      const s = sym.trim().toUpperCase()
      return merged.find((item) => item.symbol.toUpperCase() === s) ?? null
    }

    const storedFrom = byKey(parsed?.fromKey) ?? bySym(parsed?.from)
    const storedTo = byKey(parsed?.toKey) ?? bySym(parsed?.to)

    setFromToken((storedFrom ?? defaultFrom ?? placeholder) as SwapToken)
    setToToken((storedTo ?? defaultTo ?? placeholder) as SwapToken)
    setPickerTarget(null)
    setPickerQuery('')
    setLiveQuote(null)
    setQuoteError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- customEvmTokens 见上方注释
  }, [quickTradeKeysPresent, defaultFrom, defaultTo, placeholder, swapSelectionKey, tokenOptions])

  /** 行情「快捷交易」：先切换目标链，再按地址/符号预填（避免在错误网络上匹配 token） */
  useEffect(() => {
    const qs = searchParams.toString()
    if (!qs) return

    const chainTarget = parseSwapChainQuery(searchParams.get('chain'))
    const fromQ = (searchParams.get('from') ?? '').trim()
    const toQ = (searchParams.get('to') ?? '').trim()
    const fromAddrQ = (searchParams.get('fromAddr') ?? '').trim()
    const toAddrQ = (searchParams.get('toAddr') ?? '').trim()
    const amountQ = (searchParams.get('amount') ?? '').trim()

    const hasTokenParams = Boolean(fromQ || toQ || fromAddrQ || toAddrQ || amountQ)
    if (!chainTarget && !hasTokenParams) return

    let cancelled = false

    const findByAddr = (addr: string, merged: SwapToken[]) => {
      const a = addr.toLowerCase()
      return merged.find((t) => t.address.toLowerCase() === a) ?? null
    }
    const findBySym = (sym: string, merged: SwapToken[]) => {
      const s = sym.trim().toUpperCase()
      if (!s) return null
      return merged.find((t) => t.symbol.toUpperCase() === s) ?? null
    }

    const resolveEvmAddr = async (addrRaw: string): Promise<EvmToken | null> => {
      const addrNorm = parseEvmAddressInput(addrRaw)
      if (cancelled || !addrNorm || !isSupportedSwapNetwork(network)) return null
      const readProvider =
        provider ?? new ethers.JsonRpcProvider(NETWORK_CONFIG[network as SupportedSwapNetwork].rpcUrls[0])
      const info = await fetchEvmTokenByAddress(readProvider, addrNorm)
      if (!info) return null
      const token: EvmToken = {
        symbol: info.symbol,
        name: info.symbol,
        address: addrNorm,
        decimals: info.decimals,
        isNative: false,
        tone: 'sky',
      }
      setCustomEvmTokens((prev) =>
        prev.some((t) => t.address.toLowerCase() === token.address.toLowerCase()) ? prev : [...prev, token],
      )
      return token
    }

    void (async () => {
      if (chainTarget && network !== chainTarget) {
        try {
          await switchNetwork(chainTarget)
        } catch {
          /* switchNetwork 内部已提示 */
        }
        return
      }

      if (!hasTokenParams) {
        setSearchParams((prev) => {
          const p = new URLSearchParams(prev)
          p.delete('chain')
          return p
        }, { replace: true })
        return
      }

      if (!isSupportedSwapNetwork(network)) {
        setSearchParams({}, { replace: true })
        return
      }

      if (tokenOptions.length === 0) return

      const merged: SwapToken[] = [...tokenOptions, ...customEvmTokens]

      let nextFrom: SwapToken | null = fromAddrQ ? findByAddr(fromAddrQ, merged) : null
      let nextTo: SwapToken | null = toAddrQ ? findByAddr(toAddrQ, merged) : null

      if (fromAddrQ && !nextFrom) {
        nextFrom = await resolveEvmAddr(fromAddrQ)
      }
      if (toAddrQ && !nextTo) {
        nextTo = await resolveEvmAddr(toAddrQ)
      }

      if (cancelled) return

      if (!nextFrom && fromQ) nextFrom = findBySym(fromQ, merged)
      if (!nextTo && toQ) nextTo = findBySym(toQ, merged)

      if (nextFrom) setFromToken(nextFrom)
      if (nextTo) setToToken(nextTo)

      const amountNum = Number(amountQ)
      if (Number.isFinite(amountNum) && amountNum > 0) setAmountIn(String(amountNum))

      if (nextFrom && nextTo) {
        window.localStorage.setItem(
          swapSelectionKey,
          JSON.stringify({
            from: nextFrom.symbol,
            to: nextTo.symbol,
            fromKey: swapTokenStorageKey(nextFrom),
            toKey: swapTokenStorageKey(nextTo),
          }),
        )
      }

      setSearchParams({}, { replace: true })
    })()

    return () => {
      cancelled = true
    }
  }, [
    customEvmTokens,
    network,
    provider,
    searchParams,
    setSearchParams,
    swapSelectionKey,
    switchNetwork,
    tokenOptions,
  ])

  useEffect(() => {
    const stored = window.localStorage.getItem(`recentSwapTokens:${network}`)
    setRecentSymbols(stored ? JSON.parse(stored) as string[] : [])
  }, [network])

  useEffect(() => {
    const stored = window.localStorage.getItem(swapSlippageKey)
    if (stored) {
      setSlippage(stored)
      setCustomSlippage(stored)
    } else {
      setSlippage('2')
      setCustomSlippage('2')
    }
  }, [swapSlippageKey])

  const persistHistory = useCallback((updater: (current: SwapHistoryItem[]) => SwapHistoryItem[]) => {
    setHistoryItems((current) => {
      const next = updater(current).slice(0, 8)
      window.localStorage.setItem(swapHistoryKey, JSON.stringify(next))
      return next
    })
  }, [swapHistoryKey])

  useEffect(() => {
    const stored = window.localStorage.getItem(swapHistoryKey)
    setHistoryItems(stored ? JSON.parse(stored) as SwapHistoryItem[] : [])
  }, [swapHistoryKey])

  useEffect(() => {
    const stored = window.localStorage.getItem(swapHistoryFilterKey) as HistoryFilter | null
    setHistoryFilter(stored ?? 'all')
  }, [swapHistoryFilterKey])

  useEffect(() => {
    window.localStorage.setItem(
      swapSelectionKey,
      JSON.stringify({
        from: fromToken.symbol,
        to: toToken.symbol,
        fromKey: swapTokenStorageKey(fromToken),
        toKey: swapTokenStorageKey(toToken),
      }),
    )
  }, [fromToken, swapSelectionKey, toToken])

  useEffect(() => {
    if (!pickerTarget) {
      setPickerQuery('')
    }
  }, [pickerTarget])

  useEffect(() => {
    window.localStorage.setItem(swapSlippageKey, slippage)
  }, [slippage, swapSlippageKey])

  useEffect(() => {
    window.localStorage.setItem(swapHistoryFilterKey, historyFilter)
  }, [historyFilter, swapHistoryFilterKey])

  useEffect(() => {
    if (!error && !txHash && !approveBroadcastHash) return
    const timer = window.setTimeout(() => {
      setError(null)
      setApproveBroadcastHash(null)
      setTxHash(null)
    }, 4200)
    return () => window.clearTimeout(timer)
  }, [approveBroadcastHash, error, txHash])

  useEffect(() => {
    if (!liveQuote) {
      setConfirmOpen(false)
    }
  }, [liveQuote])

  useEffect(() => {
    if (!liveQuote && !confirmOpen) {
      return
    }

    const timer = window.setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [confirmOpen, liveQuote])

  useEffect(() => {
    if (!quoteSupported) {
      setFromTokenBalance(null)
      setToTokenBalance(null)
      return
    }

    let cancelled = false
    if (provider && address) {
      void Promise.all([
        readTokenBalance(provider, address, fromToken),
        readTokenBalance(provider, address, toToken),
      ])
        .then(([nextFromBalance, nextToBalance]) => {
          if (cancelled) return
          setFromTokenBalance(nextFromBalance)
          setToTokenBalance(nextToBalance)
        })
        .catch(() => {
          if (cancelled) return
          setFromTokenBalance(null)
          setToTokenBalance(null)
        })
    } else {
      setFromTokenBalance(null)
      setToTokenBalance(null)
    }

    return () => {
      cancelled = true
    }
  }, [address, fromToken, provider, quoteSupported, refreshNonce, toToken])

  useEffect(() => {
    if (!quoteSupported) return

    const pendingHashes = historyItems.filter((item) => item.status === 'pending' && item.txHash).map((item) => item.txHash as string)
    if (pendingHashes.length === 0) return

    let cancelled = false

    if (!provider) return
    const pollReceipts = async () => {
      const receipts = await Promise.all(
        pendingHashes.map(async (hash) => {
          try {
            const receipt = await provider.getTransactionReceipt(hash)
            return { hash, receipt }
          } catch {
            return { hash, receipt: null }
          }
        }),
      )
      if (cancelled) return
      const resolved = receipts.filter((item) => item.receipt)
      if (resolved.length === 0) return
      let shouldRefresh = false
      persistHistory((current) =>
        current.map((item) => {
          if (item.status !== 'pending' || !item.txHash) return item
          const matched = resolved.find((entry) => entry.hash === item.txHash)
          if (!matched?.receipt) return item
          shouldRefresh = true
          return { ...item, status: matched.receipt.status === 1 ? 'success' : 'failed' }
        }),
      )
      if (shouldRefresh) void refreshBalance()
    }
    void pollReceipts()
    const interval = setInterval(pollReceipts, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [historyItems, persistHistory, provider, quoteSupported, refreshBalance])

  useEffect(() => {
    if (!quoteSupported || !amountIn || !fromToken.symbol || !toToken.symbol || fromToken.symbol === toToken.symbol) {
      setLiveQuote(null)
      setQuoteLoading(false)
      setQuoteError(
        !quoteSupported
          ? '当前网络暂未接入真实 EVM 兑换。'
          : fromToken.symbol === toToken.symbol
            ? '请选择不同的兑换币种。'
            : null,
      )
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setQuoteLoading(true)
      setQuoteError(null)

      if (swapQuoteProvider && isSupportedSwapNetwork(network)) {
        void getBestLiveQuote({
          provider: swapQuoteProvider,
          network: network as SupportedSwapNetwork,
          fromToken,
          toToken,
          amountIn,
          slippagePercent: Math.max(0.1, Number(slippage || '2')),
          swapperAddress: address ?? undefined,
        })
          .then((quote) => {
            if (cancelled) return
            setLiveQuote(quote)
          })
          .catch((quoteFailure) => {
            if (cancelled) return
            setLiveQuote(null)
            setQuoteError(getQuoteErrorMessage(quoteFailure))
          })
          .finally(() => {
            if (!cancelled) setQuoteLoading(false)
          })
      } else {
        setQuoteLoading(false)
      }
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [address, amountIn, fromToken, network, quoteRefreshNonce, quoteSupported, slippage, swapQuoteProvider, toToken])

  const amountInNumber = Number(amountIn || '0')
  const fromTokenBalanceNumber = Number(fromTokenBalance ?? '0')
  const toTokenBalanceNumber = Number(toTokenBalance ?? '0')
  const estimatedOutNum = liveQuote && liveQuote.estimatedOut !== '—' ? Number(liveQuote.estimatedOut) : 0
  const fromUsdValue =
    liveQuote
      ? (deriveUsdFromQuote(amountInNumber, estimatedOutNum, fromToken.symbol, toToken.symbol) ?? amountInNumber * (getPrice(fromToken.symbol, network) || 0))
      : amountInNumber * (getPrice(fromToken.symbol, network) || 0)
  /** 收到代币一侧的美元估值：稳定币用面值；否则与支出侧名义一致或按 to 单价估算 */
  const receiveUsdHint =
    liveQuote && estimatedOutNum > 0 && amountInNumber > 0
      ? STABLECOIN_SYMBOLS.has(toToken.symbol)
        ? estimatedOutNum
        : fromUsdValue > 0
          ? fromUsdValue
          : (() => {
              const pt = getPrice(toToken.symbol, network)
              return pt > 0 ? estimatedOutNum * pt : null
            })()
      : null
  const routeHopCount = liveQuote ? Math.max(0, liveQuote.routeSymbols.length - 1) : 0
  const priceImpactPercent = liveQuote
    ? Number((routeHopCount * 0.55 + (liveQuote.quoteMode === 'v2' ? 0.8 : 0.35)).toFixed(2))
    : 0
  const lpFeeUsd = liveQuote ? Math.max(0.01, fromUsdValue * (liveQuote.quoteMode === 'v2' ? 0.003 : 0.0005)) : 0
  const nativeSymbol = NETWORK_CONFIG[network].symbol
  const derivedNative = liveQuote && amountInNumber > 0
    ? deriveNativePriceFromQuote(amountInNumber, estimatedOutNum, fromToken.symbol, toToken.symbol, nativeSymbol)
    : null
  const nativeTokenPriceUsd = derivedNative ?? (getPrice(nativeSymbol, network) || 0)
  const rawGasUsd = liveQuote && 'gasEstimateUsd' in liveQuote ? liveQuote.gasEstimateUsd ?? null : null
  const gasWei = liveQuote && 'gasEstimate' in liveQuote ? liveQuote.gasEstimate : null
  const networkFeeUsd =
    gasWei != null && nativeTokenPriceUsd > 0
      ? Number(gasWei) / 1e18 * nativeTokenPriceUsd
      : rawGasUsd
  const gasReserveNative =
    fromToken.isNative
      ? networkFeeUsd != null && nativeTokenPriceUsd > 0
        ? networkFeeUsd / nativeTokenPriceUsd
        : 0.003
      : 0
  const maxSpendableAmount = Math.max(0, fromTokenBalanceNumber - gasReserveNative)
  const insufficientInputBalance = amountInNumber > (fromToken.isNative ? maxSpendableAmount : fromTokenBalanceNumber) + 1e-9
  const quoteExpired = liveQuote ? liveQuote.expiresAt < currentTime : false
  const canSubmit = Boolean(
    amountIn &&
    liveQuote &&
    !quoteLoading &&
    !quoteError &&
    !quoteExpired &&
    !insufficientInputBalance &&
    (address && signer),
  )
  const routeLabel = liveQuote?.routeLabel ?? `${fromToken.symbol} > ${toToken.symbol} · ${chainName}`
  const slippageValue = Math.max(0.1, Number(slippage || '2'))
  const suggestedSlippage = liveQuote ? (liveQuote.quoteMode === 'v2' ? (routeHopCount > 1 ? '3' : '1') : routeHopCount > 1 ? '1' : '0.5') : '1'
  const needsHigherSlippage = liveQuote ? slippageValue < Number(suggestedSlippage) : false
  const riskLevel =
    quoteError || quoteExpired
      ? 'high'
      : priceImpactPercent >= 2
        ? 'high'
        : priceImpactPercent >= 1
          ? 'medium'
          : 'low'
  const riskCopy =
    quoteError
      ? quoteError
      : insufficientInputBalance
        ? fromToken.isNative
          ? `余额不足，已为 gas 预留约 ${gasReserveNative.toFixed(4)} ${fromToken.symbol}。`
          : `余额不足，当前最多可支付 ${fromTokenBalanceNumber.toFixed(4)} ${fromToken.symbol}。`
      : quoteExpired
        ? '当前报价已过期，请等待系统重新刷新后再提交。'
      : riskLevel === 'high'
        ? '当前真实路由较复杂，建议提高滑点或减小金额后再执行。'
      : riskLevel === 'medium'
        ? '当前使用真实链上报价，存在一定执行波动，建议确认最少收到。'
        : liveQuote
          ? `已自动选择最优路由：${liveQuote.protocolLabel}。`
          : '输入数量后将自动拉取最优链上报价。'
  const hasWallet = address
  const swapButtonTone =
    !hasWallet || !canSubmit ? 'disabled' : riskLevel === 'high' ? 'danger' : riskLevel === 'medium' ? 'warn' : 'normal'
  const stageCopy =
    executionStage === 'approving'
      ? approveBroadcastHash
        ? `授权已广播，等待 ${fromToken.symbol} 授权确认`
        : `正在授权 ${fromToken.symbol}`
      : executionStage === 'swapping'
        ? `正在通过 ${liveQuote?.protocolLabel ?? '路由'} 提交兑换`
        : null
  const toastTone = error ? 'error' : txHash ? 'success' : approveBroadcastHash || executionStage ? 'progress' : null
  const toastCopy = error
    ? error
    : txHash
      ? `已广播 ${txHash.slice(0, 10)}…`
      : approveBroadcastHash
        ? `授权已广播 ${approveBroadcastHash.slice(0, 10)}…，等待链上确认`
      : executionStage === 'approving'
        ? `正在授权 ${fromToken.symbol}`
        : executionStage === 'swapping'
          ? '交易已广播，等待链上返回哈希'
          : null
  const quoteSecondsLeft = liveQuote ? Math.max(0, Math.ceil((liveQuote.expiresAt - currentTime) / 1000)) : 0

  const allTokenOptions = useMemo((): SwapToken[] => {
    const base = [...tokenOptions]
    const seen = new Set(tokenOptions.map((t) => t.address.toLowerCase()))
    for (const t of customEvmTokens) {
      const key = t.address.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        base.push(t)
      }
    }
    return base
  }, [customEvmTokens, tokenOptions])

  const filteredOptions = useMemo(() => {
    const raw = pickerQuery.trim()
    if (!raw) return allTokenOptions
    const qLower = raw.toLowerCase()
    const parsedAddr = parseEvmAddressInput(raw)
    if (parsedAddr) {
      const exact = allTokenOptions.filter((t) => t.address.toLowerCase() === parsedAddr)
      if (exact.length > 0) return exact
    }
    return allTokenOptions.filter(
      (token) =>
        token.symbol.toLowerCase().includes(qLower) ||
        token.name.toLowerCase().includes(qLower) ||
        token.address.toLowerCase().includes(qLower),
    )
  }, [allTokenOptions, pickerQuery])

  const pickerListTokens = useMemo(() => {
    const local = filteredOptions
    const seen = new Set(local.map((t) => t.address.toLowerCase()))
    const extra = dexPickerTokens.filter((t) => !seen.has(t.address.toLowerCase()))
    return [...local, ...extra]
  }, [dexPickerTokens, filteredOptions])

  useEffect(() => {
    if (!pickerTarget || !isSupportedSwapNetwork(network)) {
      setDexPickerTokens([])
      setDexPickerLoading(false)
      return
    }
    const q = pickerQuery.trim()
    if (q.length < 2) {
      setDexPickerTokens([])
      setDexPickerLoading(false)
      return
    }
    let cancelled = false
    setDexPickerLoading(true)
    const timer = window.setTimeout(() => {
      void searchSwapPickerMarketItems(q, network as 'mainnet' | 'base' | 'bsc')
        .then((items) => {
          if (cancelled) return
          const mapped: EvmToken[] = items.map((it) => ({
            symbol: (it.symbol || '?').slice(0, 32),
            name: it.name || it.symbol,
            address: dexMarketIdToTokenAddress(it.id),
            decimals: 18,
            isNative: false,
            tone: 'sky',
          }))
          setDexPickerTokens(mapped)
        })
        .catch(() => {
          if (!cancelled) setDexPickerTokens([])
        })
        .finally(() => {
          if (!cancelled) setDexPickerLoading(false)
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [network, pickerQuery, pickerTarget])

  const parsedPickerAddr = useMemo(() => parseEvmAddressInput(pickerQuery.trim()), [pickerQuery])
  const showAddByAddress =
    isSupportedSwapNetwork(network) &&
    parsedPickerAddr != null &&
    !allTokenOptions.some((t) => t.address.toLowerCase() === parsedPickerAddr)
  const recentOptions = useMemo(
    () => recentSymbols.map((symbol) => allTokenOptions.find((token) => token.symbol === symbol)).filter(Boolean) as SwapToken[],
    [allTokenOptions, recentSymbols],
  )
  const hasPendingHistory = historyItems.some((item) => item.status === 'pending')
  const filteredHistoryItems = useMemo(
    () => (historyFilter === 'all' ? historyItems : historyItems.filter((item) => item.status === historyFilter)),
    [historyFilter, historyItems],
  )
  const activeHistoryItem = activeHistoryId ? historyItems.find((item) => item.id === activeHistoryId) ?? null : null

  const formatHistoryTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const applyHistoryToForm = (item: SwapHistoryItem, refillAmount: boolean) => {
    const nextFrom = allTokenOptions.find((token) => token.symbol === item.fromSymbol)
    const nextTo = allTokenOptions.find((token) => token.symbol === item.toSymbol)
    if (!nextFrom || !nextTo) return

    setFromToken(nextFrom)
    setToToken(nextTo)
    if (refillAmount) {
      setAmountIn(item.amountIn)
    }
    recordRecentToken(nextFrom)
    recordRecentToken(nextTo)
    setActiveHistoryId(null)
  }

  const handleCopyHash = async (item: SwapHistoryItem) => {
    if (!item.txHash || !navigator.clipboard) return
    await navigator.clipboard.writeText(item.txHash)
    setCopiedHistoryId(item.id)
    window.setTimeout(() => {
      setCopiedHistoryId((current) => (current === item.id ? null : current))
    }, 1200)
  }

  const openTxExplorer = (hash?: string | null) => {
    if (!hash || !explorerTxBase) return
    window.open(`${explorerTxBase}${hash}`, '_blank', 'noopener,noreferrer')
  }

  const recordRecentToken = useCallback((token: SwapToken) => {
    setRecentSymbols((current) => {
      const next = [token.symbol, ...current.filter((item) => item !== token.symbol)].slice(0, 4)
      window.localStorage.setItem(`recentSwapTokens:${network}`, JSON.stringify(next))
      return next
    })
  }, [network])

  const handleSwitchTokens = () => {
    setFromToken(toToken)
    setToToken(fromToken)
  }

  const handleSelectToken = useCallback(
    (token: SwapToken) => {
      void (async () => {
        const readP = provider ?? readOnlyProvider
        let resolved = token
        if (!token.isNative && readP) {
          const inBuiltin = tokenOptions.some((t) => t.address.toLowerCase() === token.address.toLowerCase())
          if (!inBuiltin) {
            try {
              const info = await fetchEvmTokenByAddress(readP, token.address)
              if (info) {
                resolved = {
                  ...token,
                  symbol: info.symbol || token.symbol,
                  name: token.name && token.name !== token.symbol ? token.name : info.symbol || token.name,
                  decimals: info.decimals,
                }
              }
            } catch {
              /* 仍使用列表中的占位 decimals */
            }
          }
        }

        if (pickerTarget === 'from') {
          if (resolved.address.toLowerCase() === toToken.address.toLowerCase() || resolved.symbol === toToken.symbol) {
            setToToken(fromToken)
          }
          setFromToken(resolved)
        }

        if (pickerTarget === 'to') {
          if (resolved.symbol === fromToken.symbol) {
            setFromToken(toToken)
          }
          setToToken(resolved)
        }

        setCustomEvmTokens((prev) => {
          if (prev.some((t) => t.address.toLowerCase() === resolved.address.toLowerCase())) return prev
          if (tokenOptions.some((t) => t.address.toLowerCase() === resolved.address.toLowerCase())) return prev
          return [...prev, resolved]
        })

        recordRecentToken(resolved)
        setPickerTarget(null)
      })()
    },
    [
      fromToken,
      pickerTarget,
      provider,
      readOnlyProvider,
      toToken,
      tokenOptions,
      recordRecentToken,
    ],
  )

  const handleAddCustomEvmToken = useCallback(async () => {
    const norm = parseEvmAddressInput(pickerQuery.trim())
    const readProvider = provider ?? readOnlyProvider
    if (!norm || !readProvider || customTokenLoading) return
    setCustomTokenLoading(true)
    try {
      const info = await fetchEvmTokenByAddress(readProvider, norm)
      const token: EvmToken = {
        symbol: info?.symbol ?? norm.slice(0, 12),
        name: info?.symbol ?? 'Unknown',
        address: norm,
        decimals: info?.decimals ?? 18,
        isNative: false,
        tone: 'sky',
      }
      setCustomEvmTokens((prev) => (prev.some((t) => t.address.toLowerCase() === norm) ? prev : [...prev, token]))
      handleSelectToken(token)
      setPickerQuery('')
    } catch {
      const token: EvmToken = {
        symbol: norm.slice(0, 12),
        name: 'Unknown',
        address: norm,
        decimals: 18,
        isNative: false,
        tone: 'sky',
      }
      setCustomEvmTokens((prev) => (prev.some((t) => t.address.toLowerCase() === norm) ? prev : [...prev, token]))
      handleSelectToken(token)
      setPickerQuery('')
    } finally {
      setCustomTokenLoading(false)
    }
  }, [pickerQuery, customTokenLoading, provider, readOnlyProvider, handleSelectToken])

  const handleSwap = async () => {
    if (!amountIn || !liveQuote) return
    if (quoteExpired) {
      setError('报价已过期，请等待系统刷新后再提交。')
      return
    }

    const historyId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pendingRecord: SwapHistoryItem = {
      id: historyId,
      fromSymbol: fromToken.symbol,
      toSymbol: toToken.symbol,
      amountIn: amountInNumber.toFixed(4),
      estimatedOut: liveQuote?.estimatedOut ?? estimatedOutNum.toFixed(6),
      network,
      status: 'pending',
      protocol: liveQuote.protocolLabel,
      timestamp: Date.now(),
    }
    setLoading(true)
    setError(null)
    setApproveBroadcastHash(null)
    setTxHash(null)
    setExecutionStage(null)
    setConfirmOpen(false)
    setRiskConfirmOpen(false)
    persistHistory((current) => [pendingRecord, ...current])

    try {
      if (signer && address) {
        if (!swapQuoteProvider || !isSupportedSwapNetwork(network)) {
          throw new Error('无法连接链上节点以确认最新报价')
        }
        const slippagePercent = Math.max(0.1, Number(slippage || '2'))
        const freshQuote = await getBestLiveQuote({
          provider: swapQuoteProvider,
          network: network as SupportedSwapNetwork,
          fromToken,
          toToken,
          amountIn,
          slippagePercent,
          swapperAddress: address,
          useExtendedPaths: true,
        })
        setLiveQuote(freshQuote)

        const result = await executeQuotedSwap(signer, address, freshQuote, {
          onStageChange: (stage) => {
            setExecutionStage(stage)
            persistHistory((current) =>
              current.map((item) =>
                item.id === historyId ? { ...item, stage } : item,
              ),
            )
          },
          onApproveBroadcast: (approveHash) => {
            setApproveBroadcastHash(approveHash)
            persistHistory((current) =>
              current.map((item) =>
                item.id === historyId ? { ...item, approveHash, stage: 'approving' } : item,
              ),
            )
          },
        })
        setApproveBroadcastHash(null)
        setTxHash(result.swapHash)
        persistHistory((current) =>
          current.map((item) =>
            item.id === historyId
              ? { ...item, stage: 'swapping', approveHash: result.approveHash, txHash: result.swapHash }
              : item,
          ),
        )
        setAmountIn('')
      } else {
        throw new Error('请先创建或导入钱包')
      }
    } catch (e) {
      console.error(e)
      setError(getQuoteErrorMessage(e))
      persistHistory((current) =>
        current.map((item) =>
          item.id === historyId ? { ...item, status: 'failed' } : item,
        ),
      )
    } finally {
      setLoading(false)
      setExecutionStage(null)
    }
  }

  const handlePrimaryAction = () => {
    if (!canSubmit || loading) return
    if (riskLevel === 'high') {
      setRiskConfirmOpen(true)
      return
    }
    setConfirmOpen(true)
  }

  const applySlippage = (value: string) => {
    const numeric = Number(value)
    const next = Number.isFinite(numeric) && numeric > 0 ? Math.min(50, numeric) : 2
    const formatted = Number.isInteger(next) ? String(next) : next.toFixed(1)
    setSlippage(formatted)
    setCustomSlippage(formatted)
    setSlippageOpen(false)
  }

  return (
    <div className="page ave-page ave-swap-shell">
      {config?.notice && (
        <div className="home-status-note" style={{ marginBottom: 12 }}>
          {config.notice}
        </div>
      )}
      <div className="swap-mode-segment">
        <button type="button" className="active">兑换&跨链</button>
        <button type="button">池子</button>
      </div>

      <div className="swap-white-panel">
        <div className="swap-lite-card swap-lite-card-top">
          <div className="swap-lite-label-row">
            <span>从</span>
            <span>
              余额: {fromTokenBalance != null ? fromTokenBalanceNumber.toFixed(4) : fromToken.isNative && balance ? Number(balance).toFixed(4) : '0.0000'}{' '}
              <button type="button" className="swap-max-btn" onClick={() => setAmountIn((fromToken.isNative ? maxSpendableAmount : fromTokenBalanceNumber).toString())}>
                最大
              </button>
            </span>
          </div>
          <div className="swap-lite-content">
            <div className="swap-token-meta">
              <button type="button" className="swap-token-chip swap-token-chip-btn" onClick={() => setPickerTarget('from')}>
                <span className={`swap-token-chip-icon swap-token-chip-icon-${fromToken.tone}`} aria-hidden="true">
                  {fromToken.symbol[0]}
                </span>
                <div>
                  <div className="swap-token-main">{fromToken.symbol}</div>
                  <div className="swap-token-sub">{fromToken.symbol}</div>
                </div>
                <span className="swap-token-caret">⌄</span>
              </button>
            </div>
            <div className="swap-amount-wrap">
              <input
                type="number"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="swap-lite-input"
                placeholder="0.0"
              />
              <div className="swap-amount-hint">{fromUsdValue > 0 ? `$${fromUsdValue >= 1 ? fromUsdValue.toFixed(2) : fromUsdValue.toFixed(4)}` : '—'}</div>
              {fromToken.isNative && fromTokenBalance != null && (
                <div className="swap-amount-meta">已自动预留约 {gasReserveNative.toFixed(4)} {fromToken.symbol} 作为 gas</div>
              )}
            </div>
          </div>
        </div>

        <button type="button" className="swap-lite-switch" aria-label="切换代币" onClick={handleSwitchTokens}>
          <span className="swap-lite-switch-arrows">↕</span>
        </button>

        <div className="swap-lite-card">
          <div className="swap-lite-label-row">
            <span>到</span>
            <span>余额: {toTokenBalance != null ? toTokenBalanceNumber.toFixed(4) : '0.0000'}</span>
          </div>
          <div className="swap-lite-content">
            <div className="swap-token-meta">
              <button type="button" className="swap-token-chip swap-token-chip-btn" onClick={() => setPickerTarget('to')}>
                <span className={`swap-token-chip-icon swap-token-chip-icon-${toToken.tone}`} aria-hidden="true">
                  {toToken.symbol[0]}
                </span>
                <div>
                  <div className="swap-token-main">{toToken.symbol}</div>
                  <div className="swap-token-sub">{toToken.symbol}</div>
                </div>
                <span className="swap-token-caret">⌄</span>
              </button>
            </div>
            <div className="swap-amount-wrap">
              <div className="swap-lite-output">{quoteLoading ? '报价中…' : liveQuote?.estimatedOut ?? '0.0'}</div>
              <div className="swap-amount-hint">
                {receiveUsdHint != null && receiveUsdHint > 0 ? (
                  <span className="swap-amount-hint-usd">
                    约 ${receiveUsdHint >= 1 ? receiveUsdHint.toFixed(2) : receiveUsdHint.toFixed(4)} ·{' '}
                  </span>
                ) : null}
                {liveQuote ? `${liveQuote.protocolLabel}` : quoteSupported ? '等待真实报价' : '当前网络未接入'}
              </div>
            </div>
          </div>
        </div>

        <div className="swap-rate-note">
          {liveQuote
            ? (liveQuote.estimatedOut === '—'
              ? `1 ${fromToken.symbol} ≈ — ${toToken.symbol}`
              : `1 ${fromToken.symbol} ≈ ${(Number(liveQuote.estimatedOut) / Math.max(amountInNumber, 1e-9)).toFixed(6)} ${toToken.symbol}`)
            : '输入数量后获取真实链上报价'}
        </div>

        <div className="swap-estimate-grid">
          <div className="swap-estimate-row">
            <span>最优路由</span>
            <span>{routeLabel}</span>
          </div>
          <div className="swap-estimate-row">
            <span>最少收到</span>
            <span>{liveQuote ? `${liveQuote.minimumReceived} ${toToken.symbol}` : '0.00'}</span>
          </div>
          <div className="swap-estimate-row">
            <span>价格影响</span>
            <span className={priceImpactPercent > 1 ? 'down' : ''}>{liveQuote ? `${priceImpactPercent.toFixed(2)}%` : '--'}</span>
          </div>
          <div className="swap-estimate-row">
            <span>LP 手续费</span>
            <span>{liveQuote ? `$${lpFeeUsd.toFixed(2)}` : '--'}</span>
          </div>
          <div className="swap-estimate-row">
            <span>预估网络费</span>
            <span>{networkFeeUsd != null ? `$${networkFeeUsd.toFixed(4)}` : '--'}</span>
          </div>
        </div>

        <div className={`swap-risk-note swap-risk-note-${riskLevel}`}>
          <div className="swap-risk-title">
            {!quoteSupported ? '网络未接入' : quoteLoading ? '报价更新中' : riskLevel === 'high' ? '高风险提醒' : riskLevel === 'medium' ? '成交提醒' : '报价状态'}
          </div>
          <div className="swap-risk-desc">{riskCopy}</div>
          {stageCopy && <div className="swap-risk-stage">{stageCopy}</div>}
          {needsHigherSlippage && (
            <button
              type="button"
              className="swap-risk-action"
              onClick={() => applySlippage(suggestedSlippage)}
            >
              使用建议滑点 {suggestedSlippage}%
            </button>
          )}
        </div>

        <button
          type="button"
          className={`swap-one-click-btn swap-one-click-btn-${swapButtonTone}`}
          disabled={loading || !canSubmit}
          onClick={handlePrimaryAction}
        >
          {!hasWallet
            ? '请先在钱包页创建或导入钱包'
            : loading
              ? executionStage === 'approving'
                ? `授权 ${fromToken.symbol} 中…`
                : executionStage === 'swapping'
                  ? '广播兑换中…'
                  : '提交中…'
              : !quoteSupported
                ? '当前网络暂未接入真实 EVM 兑换'
              : riskLevel === 'high'
                ? `高冲击兑换 ${fromToken.symbol}`
                : liveQuote
                  ? `${liveQuote.protocolLabel} 兑换`
                  : `一键兑换 ${fromToken.symbol}`}
        </button>
      </div>

      <div className="swap-bottom-row">
        <button type="button" className="swap-bottom-action" onClick={() => setInfoOpen(true)}>滑点 ？</button>
        <button type="button" className="swap-bottom-action swap-bottom-action-right" onClick={() => setSlippageOpen(true)}>
          自动滑点({slippage}%) ⚙
        </button>
      </div>

      <div className="swap-history-block">
        <div className="swap-history-head">
          <div className="swap-history-title">兑换历史</div>
          {hasPendingHistory && <div className="swap-history-live">链上确认中</div>}
        </div>
        {historyItems.length > 0 && (
          <div className="swap-history-filters">
            {[
              ['all', '全部'],
              ['pending', '确认中'],
              ['success', '已完成'],
              ['failed', '失败'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`swap-history-filter ${historyFilter === value ? 'active' : ''}`}
                onClick={() => setHistoryFilter(value as HistoryFilter)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {historyItems.length === 0 ? (
          <div className="swap-history-empty">
            <div className="swap-history-empty-icon" />
            <div>暂无记录</div>
          </div>
        ) : filteredHistoryItems.length === 0 ? (
          <div className="swap-history-filter-empty">当前筛选下暂无记录</div>
        ) : (
          <div className="swap-history-list">
            {filteredHistoryItems.map((item) => (
              <button key={item.id} type="button" className="swap-history-card" onClick={() => setActiveHistoryId(item.id)}>
                <div className="swap-history-card-top">
                  <div>
                    <div className="swap-history-pair">{item.fromSymbol} → {item.toSymbol}</div>
                    <div className="swap-history-meta">
                      {item.network.toUpperCase()} · {formatHistoryTime(item.timestamp)}
                      {item.protocol ? ` · ${item.protocol}` : ''}
                    </div>
                  </div>
                  <div className={`swap-history-status swap-history-status-${item.status}`}>
                    {item.status === 'pending' ? '确认中' : item.status === 'success' ? '已完成' : '失败'}
                  </div>
                </div>
                <div className="swap-history-amounts">
                  <span>{item.amountIn} {item.fromSymbol}</span>
                  <span>{item.estimatedOut} {item.toSymbol}</span>
                </div>
                {item.status === 'pending' && item.stage && (
                  <div className="swap-history-step">{getPendingStageLabel(item.stage, item.approveHash)}</div>
                )}
                {item.txHash && <div className="swap-history-hash">Tx {item.txHash.slice(0, 10)}…</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {pickerTarget && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setPickerTarget(null)} aria-label="关闭代币选择器" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">{pickerTarget === 'from' ? '选择支付代币' : '选择接收代币'}</div>
              <div className="swap-token-picker-sub">{chainName}</div>
            </div>
            <div className="swap-token-picker-search">
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="搜索代币或粘贴合约地址"
                className="swap-token-picker-search-input"
              />
            </div>
            {showAddByAddress && (
              <button
                type="button"
                className="swap-token-picker-row swap-token-picker-add"
                onClick={() => void handleAddCustomEvmToken()}
                disabled={customTokenLoading}
              >
                {customTokenLoading ? '添加中…' : `添加 ${pickerQuery.trim().slice(0, 14)}… 并选择`}
              </button>
            )}
            {!pickerQuery && recentOptions.length > 0 && (
              <div className="swap-token-picker-recent">
                <div className="swap-token-picker-recent-title">最近使用</div>
                <div className="swap-token-picker-recent-list">
                  {recentOptions.map((token) => (
                    <button
                      key={token.symbol}
                      type="button"
                      className="swap-token-picker-recent-chip"
                      onClick={() => handleSelectToken(token)}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="swap-token-picker-list">
              {dexPickerLoading && pickerQuery.trim().length >= 2 && (
                <div className="swap-token-picker-loading">搜索链上代币…</div>
              )}
              {pickerListTokens.map((token) => (
                <button
                  key={token.address}
                  type="button"
                  className={`swap-token-picker-row ${
                    (pickerTarget === 'from' ? fromToken.symbol : toToken.symbol) === token.symbol ? 'active' : ''
                  }`}
                  onClick={() => handleSelectToken(token)}
                >
                  <span className={`swap-token-chip-icon swap-token-chip-icon-${token.tone}`} aria-hidden="true">
                    {(token.symbol[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="swap-token-picker-copy">
                    <div className="swap-token-picker-symbol">{token.symbol}</div>
                    <div className="swap-token-picker-name">
                      {token.isNative
                        ? '原生代币'
                        : token.name && token.name.toLowerCase() !== token.symbol.toLowerCase()
                          ? token.name
                          : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`}
                    </div>
                  </div>
                  <div className="swap-token-picker-price">{(() => { const p = getPrice(token.symbol, network); return p > 0 ? `$${p >= 1 ? p.toFixed(2) : p.toFixed(6)}` : '—'; })()}</div>
                </button>
              ))}
              {!dexPickerLoading && pickerListTokens.length === 0 && (
                <div className="swap-token-picker-empty">没有匹配的代币，可粘贴完整合约地址后添加</div>
              )}
            </div>
          </div>
        </>
      )}

      {slippageOpen && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setSlippageOpen(false)} aria-label="关闭滑点设置" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">滑点设置</div>
              <div className="swap-token-picker-sub">按当前网络单独保存</div>
            </div>
            <div className="swap-slippage-grid">
              {['0.5', '1', '2', '5'].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`swap-slippage-chip ${slippage === value ? 'active' : ''}`}
                  onClick={() => applySlippage(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <div className="swap-slippage-custom">
              <div className="swap-slippage-label">自定义</div>
              <div className="swap-slippage-input-wrap">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={customSlippage}
                  onChange={(e) => setCustomSlippage(e.target.value)}
                  className="swap-token-picker-search-input"
                />
                <button
                  type="button"
                  className="swap-slippage-save"
                  onClick={() => applySlippage(customSlippage || '2')}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {infoOpen && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setInfoOpen(false)} aria-label="关闭滑点说明" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">滑点说明</div>
              <div className="swap-token-picker-sub">根据路由和流动性动态波动</div>
            </div>
            <div className="swap-info-list">
              <div className="swap-info-item">
                <div className="swap-info-label">当前滑点</div>
                <div className="swap-info-value">{slippage}%</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">建议滑点</div>
                <div className="swap-info-value">{suggestedSlippage}%</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">当前协议</div>
                <div className="swap-info-value">{liveQuote?.protocolLabel ?? '未报价'}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">价格影响</div>
                <div className="swap-info-value">{liveQuote ? `${priceImpactPercent.toFixed(2)}%` : '--'}</div>
              </div>
            </div>
            <div className="swap-info-copy">
              真实链上报价会根据协议、池子深度和路由跳数动态变化。滑点越低，成交价格越接近报价，但更容易因链上波动而失败。
            </div>
            <button type="button" className="swap-sheet-primary" onClick={() => {
              setInfoOpen(false)
              setSlippageOpen(true)
            }}>
              去调整滑点
            </button>
          </div>
        </>
      )}

      {riskConfirmOpen && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setRiskConfirmOpen(false)} aria-label="关闭高风险确认" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">高冲击确认</div>
              <div className="swap-token-picker-sub">当前兑换可能与预期价格偏差较大</div>
            </div>
            <div className="swap-info-list">
              <div className="swap-info-item">
                <div className="swap-info-label">支付数量</div>
                <div className="swap-info-value">{amountInNumber > 0 ? amountInNumber.toFixed(4) : '0.0000'} {fromToken.symbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">最少收到</div>
                <div className="swap-info-value">{liveQuote ? liveQuote.minimumReceived : '0.00'} {toToken.symbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">价格影响</div>
                <div className="swap-info-value down">{liveQuote ? `${priceImpactPercent.toFixed(2)}%` : '--'}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">建议滑点</div>
                <div className="swap-info-value">{suggestedSlippage}%</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">执行协议</div>
                <div className="swap-info-value">{liveQuote?.protocolLabel ?? '未报价'}</div>
              </div>
            </div>
            <div className="swap-info-copy">
              如果你继续提交，这笔真实链上兑换可能因为池子深度、路由切换或链上波动而出现明显偏差。建议优先减小金额，或调高滑点后再次确认。
            </div>
            <div className="swap-sheet-actions">
              <button type="button" className="swap-sheet-secondary" onClick={() => {
                setRiskConfirmOpen(false)
                applySlippage(suggestedSlippage)
              }}>
                先调到建议滑点
              </button>
              <button type="button" className="swap-sheet-primary swap-sheet-primary-danger" onClick={() => {
                setRiskConfirmOpen(false)
                void handleSwap()
              }}>
                继续高冲击兑换
              </button>
            </div>
          </div>
        </>
      )}

      {confirmOpen && liveQuote && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setConfirmOpen(false)} aria-label="关闭兑换确认" />
          <div className="swap-token-picker-sheet swap-confirm-sheet-compact">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">确认兑换</div>
              <div className="swap-token-picker-sub">
                {quoteExpired ? '报价已过期' : `报价剩余 ${quoteSecondsLeft}s`} · {liveQuote.protocolLabel} · {chainName}
              </div>
            </div>
            <div className="swap-info-list swap-confirm-info-minimal">
              <div className="swap-info-item">
                <div className="swap-info-label">最少收到</div>
                <div className="swap-info-value">{liveQuote.minimumReceived} {toToken.symbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">路由</div>
                <div className="swap-info-value swap-info-value-route">{routeLabel}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">网络费用</div>
                <div className="swap-info-value">{networkFeeUsd != null ? `$${networkFeeUsd.toFixed(4)}` : '--'}</div>
              </div>
            </div>
            <div className="swap-info-copy swap-confirm-copy-short">
              {quoteExpired ? '报价已失效，请刷新后再确认。' : '确认后将发起链上交易。'}
            </div>
            <div className="swap-sheet-actions">
              <button
                type="button"
                className="swap-sheet-secondary"
                onClick={() => {
                  if (quoteExpired) {
                    setQuoteRefreshNonce((current) => current + 1)
                    return
                  }
                  setConfirmOpen(false)
                }}
              >
                {quoteExpired ? '刷新报价' : '再看看'}
              </button>
              <button
                type="button"
                className="swap-sheet-primary"
                disabled={quoteExpired || quoteLoading}
                onClick={() => void handleSwap()}
              >
                {quoteExpired ? '等待新报价' : quoteLoading ? '刷新报价中…' : '确认兑换'}
              </button>
            </div>
          </div>
        </>
      )}

      {activeHistoryItem && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setActiveHistoryId(null)} aria-label="关闭历史详情" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">兑换详情</div>
              <div className="swap-token-picker-sub">{activeHistoryItem.network.toUpperCase()} · {formatHistoryTime(activeHistoryItem.timestamp)}</div>
            </div>
            <div className="swap-info-list">
              <div className="swap-info-item">
                <div className="swap-info-label">交易对</div>
                <div className="swap-info-value">{activeHistoryItem.fromSymbol} → {activeHistoryItem.toSymbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">支付数量</div>
                <div className="swap-info-value">{activeHistoryItem.amountIn} {activeHistoryItem.fromSymbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">预计收到</div>
                <div className="swap-info-value">{activeHistoryItem.estimatedOut} {activeHistoryItem.toSymbol}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">状态</div>
                <div className={`swap-info-value swap-info-value-${activeHistoryItem.status}`}>
                  {activeHistoryItem.status === 'pending' ? '确认中' : activeHistoryItem.status === 'success' ? '已完成' : '失败'}
                </div>
              </div>
              {activeHistoryItem.status === 'pending' && activeHistoryItem.stage && (
                <div className="swap-info-item">
                  <div className="swap-info-label">当前阶段</div>
                  <div className="swap-info-value">{getPendingStageLabel(activeHistoryItem.stage, activeHistoryItem.approveHash)}</div>
                </div>
              )}
              {activeHistoryItem.protocol && (
                <div className="swap-info-item">
                  <div className="swap-info-label">协议</div>
                  <div className="swap-info-value">{activeHistoryItem.protocol}</div>
                </div>
              )}
              {activeHistoryItem.approveHash && (
                <div className="swap-info-item">
                  <div className="swap-info-label">授权哈希</div>
                  <div className="swap-info-value">{activeHistoryItem.approveHash.slice(0, 10)}…</div>
                </div>
              )}
              {activeHistoryItem.txHash && (
                <div className="swap-info-item">
                  <div className="swap-info-label">交易哈希</div>
                  <div className="swap-info-value">{activeHistoryItem.txHash.slice(0, 10)}…</div>
                </div>
              )}
            </div>
            <div className="swap-sheet-actions">
              <button type="button" className="swap-sheet-secondary" onClick={() => applyHistoryToForm(activeHistoryItem, false)}>
                使用此币对
              </button>
              <button type="button" className="swap-sheet-primary swap-sheet-primary-light" onClick={() => applyHistoryToForm(activeHistoryItem, true)}>
                再次兑换
              </button>
              {activeHistoryItem.approveHash && (
                <button type="button" className="swap-sheet-secondary" onClick={() => openTxExplorer(activeHistoryItem.approveHash)}>
                  查看授权链上记录
                </button>
              )}
              {activeHistoryItem.txHash ? (
                <>
                  <button type="button" className="swap-sheet-secondary" onClick={() => void handleCopyHash(activeHistoryItem)}>
                    {copiedHistoryId === activeHistoryItem.id ? '已复制哈希' : '复制交易哈希'}
                  </button>
                  <button type="button" className="swap-sheet-secondary" onClick={() => openTxExplorer(activeHistoryItem.txHash)}>
                    打开区块浏览器
                  </button>
                </>
              ) : (
                <button type="button" className="swap-sheet-secondary" onClick={() => setActiveHistoryId(null)}>
                  关闭
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {toastTone && toastCopy && (
        <div className={`swap-toast swap-toast-${toastTone}`}>
          <div className="swap-toast-copy">{toastCopy}</div>
          {(txHash || approveBroadcastHash) && explorerTxBase && (
            <button type="button" className="swap-toast-action" onClick={() => openTxExplorer(txHash ?? approveBroadcastHash)}>
              查看链上
            </button>
          )}
          {!executionStage && (
            <button
              type="button"
              className="swap-toast-close"
              aria-label="关闭状态提示"
              onClick={() => {
                setError(null)
                setApproveBroadcastHash(null)
                setTxHash(null)
              }}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}
