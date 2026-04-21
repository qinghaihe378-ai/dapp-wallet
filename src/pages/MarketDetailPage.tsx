import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { KLineChart, type KLinePeriod } from '../components/KLineChart'
import { type MarketItem, fetchDexTokenById } from '../api/markets'
import { apiUrl } from '../lib/apiBase'
import { marketChainIdToWalletNetwork } from '../lib/marketChainMap'
import { formatCurrencyCompact, formatPriceByCurrency, useAppSettings } from '../components/AppSettingsProvider'
import fourLogo from '../assets/four-logo.svg'

interface CoinDetail {
  id: string
  symbol: string
  name: string
  image: { small: string; large: string }
  market_data: {
    current_price: { usd: number }
    price_change_percentage_24h: number
    market_cap: { usd: number }
    total_volume: { usd: number }
    high_24h: { usd: number }
    low_24h: { usd: number }
    fully_diluted_valuation?: { usd: number }
    total_supply?: number | null
  }
  links?: {
    homepage?: string[]
    twitter_screen_name?: string | null
    telegram_channel_identifier?: string | null
    subreddit_url?: string | null
  }
  asset_platform_id?: string | null
  platforms?: Record<string, string>
}

const COINGECKO_ID_REG = /^[a-zA-Z0-9_-]+$/
const DEX_ID_REG = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9]+$/

const formatCompact = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

const formatTokenAmount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value >= 1 ? value.toFixed(2) : value.toFixed(6)
}

const formatPrice = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(6)}`
}

const formatInt = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return Math.round(value).toLocaleString('en-US')
}

const shortAddress = (addr: string) => {
  const s = String(addr ?? '').trim()
  if (!s.startsWith('0x') || s.length < 12) return '—'
  return `${s.slice(0, 6)}...${s.slice(-4)}`
}

const chainToHoneypotId: Record<string, number> = {
  eth: 1,
  bsc: 56,
  polygon: 137,
  base: 8453,
  avax: 43114,
}

const platformToChain: Record<string, keyof typeof chainToHoneypotId> = {
  ethereum: 'eth',
  binance_smart_chain: 'bsc',
  polygon_pos: 'polygon',
  base: 'base',
  avalanche: 'avax',
}

const DEX_ICON_MAP: Record<string, string> = {
  four: fourLogo,
  fourmeme: fourLogo,
  'four.meme': fourLogo,
  pancakeswap: 'https://pancakeswap.finance/favicon.ico',
  uniswap: 'https://app.uniswap.org/favicon.ico',
  sushiswap: 'https://www.sushi.com/favicon.ico',
  aerodrome: 'https://aerodrome.finance/favicon.ico',
  biswap: 'https://biswap.org/favicon.ico',
}

const MAIN_PAIR_SYMBOLS = new Set(['WBNB', 'BNB', 'WETH', 'ETH', 'USDT', 'USDC', 'BUSD', 'DAI'])

export function MarketDetailPage() {
  const { currencyUnit, redUpGreenDown } = useAppSettings()
  const { coinId } = useParams<{ coinId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<CoinDetail | null>(null)
  const [dexItem, setDexItem] = useState<MarketItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<KLinePeriod>('1h')
  const [dexPairAddress, setDexPairAddress] = useState<string | null>(null)
  const [mainTab, setMainTab] = useState<'market' | 'holders' | 'detail' | 'feed' | 'risk'>('market')
  const [subTab, setSubTab] = useState<'trade' | 'pool' | 'mine' | 'orders' | 'watch' | 'creator'>('pool')
  const [indicator, setIndicator] = useState<'MA' | 'EMA' | 'BOLL' | 'VOL' | 'MACD' | 'KDJ' | 'RSI'>('VOL')
  const [toolMode, setToolMode] = useState<'1s' | 'user' | 'global' | 'search'>('1s')
  const [isFavorite, setIsFavorite] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [buyTax, setBuyTax] = useState<number | null>(null)
  const [sellTax, setSellTax] = useState<number | null>(null)
  const [pairVolume24h, setPairVolume24h] = useState<number | null>(null)
  const [pairTxns24h, setPairTxns24h] = useState<number | null>(null)
  const [recentTrades, setRecentTrades] = useState<Array<{
    txHash: string
    side: 'buy' | 'sell'
    volumeUsd: number
    from: string
    time: string
  }>>([])
  const [apiTotalHolders, setApiTotalHolders] = useState<number | null>(null)
  const [realHolders, setRealHolders] = useState<Array<{ address: string; percent: number; balance: string }>>([])
  const [totalSupply, setTotalSupply] = useState<string | null>(null)
  const [coinTypeInfo, setCoinTypeInfo] = useState<string | null>(null)
  const [communityLinks, setCommunityLinks] = useState<Array<{ label: string; url: string }>>([])
  const [pairDexId, setPairDexId] = useState<string | null>(null)
  const [tokenLogoSrc, setTokenLogoSrc] = useState<string>('')
  const [fourSnapshot, setFourSnapshot] = useState<null | {
    priceQuote: number | null
    priceQuoteText: string | null
    quoteSymbol: string
    priceChange24h: number | null
    marketCapUsd: number | null
    virtualLiquidityUsd: number | null
    volumeUsd: number | null
    totalSupply: number | null
    remainingSupply: number | null
    bondingQuoteAmount: number | null
    targetQuoteAmount: number | null
    progressPct: number | null
    maxMarketCapUsd: number | null
  }>(null)
  const [tokenPools, setTokenPools] = useState<Array<{
    pairAddress: string
    dexId: string
    topSymbol: string
    bottomSymbol: string
    topAmount: number
    bottomAmount: number
    feeLabel: string
    liquidityUsd: number
    volume24h: number
  }>>([])

  const isDexFormat = coinId && DEX_ID_REG.test(coinId)
  const isCoingeckoFormat = coinId && COINGECKO_ID_REG.test(coinId)
  const routeSource = (searchParams.get('src') ?? '').trim().toLowerCase()

  const dexTokenAddress = useMemo(() => {
    if (!dexItem?.id) return null
    return dexItem.id.split(':')[1] ?? null
  }, [dexItem?.id])

  const detailPlatformAddress = useMemo(() => {
    if (!detail?.platforms) return null
    const hit = Object.entries(detail.platforms).find(([, addr]) => typeof addr === 'string' && addr.trim().startsWith('0x'))
    return hit?.[1] ?? null
  }, [detail?.platforms])

  const securityAddress = dexTokenAddress ?? detailPlatformAddress
  const securityChain = dexItem?.chain ?? (detail?.asset_platform_id ? platformToChain[detail.asset_platform_id] : undefined) ?? null
  const tokenContractLine = useMemo(() => {
    if (!securityAddress) return '—'
    const chain = securityChain ? securityChain.toUpperCase() : ''
    return chain ? `${chain} · ${shortAddress(securityAddress)}` : shortAddress(securityAddress)
  }, [securityAddress, securityChain])

  const detailVM = useMemo(() => {
    if (dexItem) {
      return {
        symbol: dexItem.symbol?.toUpperCase() ?? '--',
        name: dexItem.name ?? dexItem.symbol?.toUpperCase() ?? '--',
        image: dexItem.image || '',
        chain: dexItem.chain?.toUpperCase() ?? '',
        price: dexItem.current_price ?? 0,
        change24h: dexItem.price_change_percentage_24h ?? 0,
        marketCap: dexItem.market_cap ?? 0,
        volume24h: 0,
        fdv: 0,
        high24h: 0,
        low24h: 0,
      }
    }

    if (detail) {
      const md = detail.market_data
      return {
        symbol: detail.symbol?.toUpperCase() ?? '--',
        name: detail.name ?? detail.symbol?.toUpperCase() ?? '--',
        image: detail.image?.large ?? detail.image?.small ?? '',
        chain: 'GLOBAL',
        price: md?.current_price?.usd ?? 0,
        change24h: md?.price_change_percentage_24h ?? 0,
        marketCap: md?.market_cap?.usd ?? 0,
        volume24h: md?.total_volume?.usd ?? 0,
        fdv: md?.fully_diluted_valuation?.usd ?? 0,
        high24h: md?.high_24h?.usd ?? 0,
        low24h: md?.low_24h?.usd ?? 0,
      }
    }

    return null
  }, [detail, dexItem])

  const quickTradeTargets = useMemo(() => {
    if (dexItem) {
      const symbol = dexItem.symbol?.toUpperCase() ?? ''
      const addr = dexTokenAddress ?? ''
      const chain = marketChainIdToWalletNetwork(dexItem.chain)
      const chainQ = `&chain=${encodeURIComponent(chain)}`
      return {
        buy: `/swap?from=USDC&to=${encodeURIComponent(symbol)}&toAddr=${encodeURIComponent(addr)}&amount=50${chainQ}`,
        sell: `/swap?from=${encodeURIComponent(symbol)}&fromAddr=${encodeURIComponent(addr)}&to=USDC&amount=50${chainQ}`,
      }
    }
    if (detail) {
      const symbol = detail.symbol?.toUpperCase() ?? ''
      return {
        buy: `/swap?from=USDC&to=${encodeURIComponent(symbol)}&amount=50`,
        sell: `/swap?from=${encodeURIComponent(symbol)}&to=USDC&amount=50`,
      }
    }
    return { buy: '/swap', sell: '/swap' }
  }, [detail, dexItem, dexTokenAddress])

  const dexScreenerChainId = useMemo(() => {
    if (!dexItem) return null
    if (dexItem.chain === 'eth') return 'ethereum'
    return dexItem.chain
  }, [dexItem])

  const geckoNetworkId = useMemo(() => {
    if (!dexItem) return null
    if (dexItem.chain === 'eth') return 'eth'
    if (dexItem.chain === 'polygon') return 'polygon_pos'
    return dexItem.chain
  }, [dexItem])
  const isFourSource =
    routeSource.includes('four') ||
    String(dexItem?.dexId ?? '').toLowerCase().includes('four') ||
    String(pairDexId ?? '').toLowerCase().includes('four')
  const shouldTryFourSnapshot = !!dexTokenAddress && ((dexItem?.chain ?? '') === 'bsc' || isFourSource)

  useEffect(() => {
    if (!coinId) return
    if (isDexFormat) {
      setLoading(true)
      setError(null)
      setDexPairAddress(null)
      fetchDexTokenById(coinId)
        .then((item) => {
          setDexItem(item ?? null)
          if (!item) setError('未找到该代币')
        })
        .catch((e) => {
          console.error(e)
          setError('加载行情失败')
        })
        .finally(() => setLoading(false))
      return
    }
    if (!isCoingeckoFormat) return
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${coinId}`,
          {
            params: {
              localization: false,
              tickers: false,
              community_data: false,
              developer_data: false,
            },
          },
        )
        setDetail(res.data)
      } catch (e) {
        console.error(e)
        setError('加载行情失败')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [coinId, isDexFormat, isCoingeckoFormat])

  useEffect(() => {
    if (!shouldTryFourSnapshot || !dexTokenAddress) {
      setFourSnapshot(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(apiUrl(`/api/four-token?address=${encodeURIComponent(dexTokenAddress)}`))
        if (!res.ok) return
        const json = await res.json() as { snapshot?: typeof fourSnapshot }
        if (!cancelled) setFourSnapshot(json.snapshot ?? null)
      } catch (e) {
        console.error('加载 four 快照失败', e)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [shouldTryFourSnapshot, dexTokenAddress])

  useEffect(() => {
    if (!dexScreenerChainId || !dexTokenAddress) return
    let cancelled = false

    const loadPair = async () => {
      try {
        setDexPairAddress(null)
        setTokenPools([])
        const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${dexScreenerChainId}/${dexTokenAddress}`)
        if (!res.ok) return
        const json = (await res.json()) as Array<{
          pairAddress?: string
          dexId?: string
          baseToken?: { symbol?: string }
          quoteToken?: { symbol?: string }
          liquidity?: { usd?: number; base?: number; quote?: number }
          volume?: { h24?: number }
          labels?: string[]
        } | null>
        const byPairAddress = new Map<string, {
          pairAddress: string
          dexId: string
          topSymbol: string
          bottomSymbol: string
          topAmount: number
          bottomAmount: number
          feeLabel: string
          liquidityUsd: number
          volume24h: number
        }>()
        for (const p of Array.isArray(json) ? json : []) {
          if (!p?.pairAddress) continue
          const pairAddress = String(p.pairAddress).toLowerCase()
          const baseSymbol = String(p.baseToken?.symbol ?? detailVM?.symbol ?? 'TOKEN').toUpperCase()
          const quoteSymbol = String(p.quoteToken?.symbol ?? 'USD').toUpperCase()
          const baseAmount = Number(p.liquidity?.base ?? 0) || 0
          const quoteAmount = Number(p.liquidity?.quote ?? 0) || 0
          const mainIsBase = MAIN_PAIR_SYMBOLS.has(baseSymbol) && !MAIN_PAIR_SYMBOLS.has(quoteSymbol)
          const topSymbol = mainIsBase ? quoteSymbol : baseSymbol
          const bottomSymbol = mainIsBase ? baseSymbol : quoteSymbol
          const topAmount = mainIsBase ? quoteAmount : baseAmount
          const bottomAmount = mainIsBase ? baseAmount : quoteAmount
          const feeLabel = (p.labels ?? []).find((x) => typeof x === 'string' && x.includes('%')) ?? ''
          const nextItem = {
            pairAddress: String(p.pairAddress),
            dexId: String(p.dexId ?? 'dex').trim() || 'dex',
            topSymbol,
            bottomSymbol,
            topAmount,
            bottomAmount,
            feeLabel,
            liquidityUsd: Number(p.liquidity?.usd ?? 0) || 0,
            volume24h: Number(p.volume?.h24 ?? 0) || 0,
          }
          const exist = byPairAddress.get(pairAddress)
          if (!exist || nextItem.liquidityUsd > exist.liquidityUsd) {
            byPairAddress.set(pairAddress, nextItem)
          }
        }
        const list = [...byPairAddress.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd)
        const pair = list[0]?.pairAddress ?? null
        if (cancelled) return
        setTokenPools(list)
        setDexPairAddress(pair)
      } catch {
        // ignore
      }
    }

    void loadPair()
    return () => { cancelled = true }
  }, [dexScreenerChainId, dexTokenAddress, detailVM?.symbol])

  useEffect(() => {
    if (!dexScreenerChainId || !dexPairAddress) {
      setPairVolume24h(null)
      setPairTxns24h(null)
      setPairDexId(null)
      return
    }
    let cancelled = false
    const loadPairStats = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexScreenerChainId}/${dexPairAddress}`)
        if (!res.ok) return
        const json = (await res.json()) as {
          pairs?: Array<{
            txns?: {
              m5?: { buys?: number; sells?: number }
              h1?: { buys?: number; sells?: number }
              h6?: { buys?: number; sells?: number }
              h24?: { buys?: number; sells?: number }
            }
            volume?: { m5?: number; h1?: number; h6?: number; h24?: number }
            dexId?: string
          }>
        }
        const p = json?.pairs?.[0]
        if (!p || cancelled) return
        const volume = p.volume?.h24
        const buys = p.txns?.h24?.buys ?? 0
        const sells = p.txns?.h24?.sells ?? 0
        setPairVolume24h(Number.isFinite(volume as number) ? Number(volume) : null)
        setPairTxns24h(Number.isFinite(buys + sells) ? buys + sells : null)
        setPairDexId(typeof p.dexId === 'string' && p.dexId.trim() ? p.dexId : null)
      } catch {
        if (cancelled) return
        setPairVolume24h(null)
        setPairTxns24h(null)
        setPairDexId(null)
      }
    }
    void loadPairStats()
    return () => { cancelled = true }
  }, [dexScreenerChainId, dexPairAddress])

  useEffect(() => {
    if (!geckoNetworkId || !dexPairAddress) {
      setRecentTrades([])
      return
    }
    let cancelled = false
    const loadTrades = async () => {
      try {
        const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${geckoNetworkId}/pools/${dexPairAddress}/trades?page=1`)
        if (!res.ok) return
        const json = (await res.json()) as {
          data?: Array<{
            attributes?: {
              tx_hash?: string
              kind?: 'buy' | 'sell'
              volume_in_usd?: string
              tx_from_address?: string
              block_timestamp?: string
            }
          }>
        }
        if (cancelled) return
        const list = (json?.data ?? [])
          .map((x) => x.attributes)
          .filter((x): x is NonNullable<typeof x> => !!x && (x.kind === 'buy' || x.kind === 'sell'))
          .slice(0, 100)
          .map((x) => ({
            txHash: x.tx_hash ?? '',
            side: x.kind as 'buy' | 'sell',
            volumeUsd: Number.parseFloat(x.volume_in_usd ?? '0') || 0,
            from: x.tx_from_address ?? '',
            time: x.block_timestamp ?? '',
          }))
        setRecentTrades(list)
      } catch {
        if (cancelled) return
        setRecentTrades([])
      }
    }
    void loadTrades()
    const iv = setInterval(loadTrades, 1000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [geckoNetworkId, dexPairAddress])

  useEffect(() => {
    const chain = securityChain
    const address = securityAddress
    if (!chain || !address) {
      setBuyTax(null)
      setSellTax(null)
      setApiTotalHolders(null)
      setRealHolders([])
      setTotalSupply(null)
      setCoinTypeInfo(null)
      setCommunityLinks([])
      return
    }
    const chainId = chainToHoneypotId[chain]
    if (!chainId) {
      setBuyTax(null)
      setSellTax(null)
      setApiTotalHolders(null)
      setRealHolders([])
      setTotalSupply(null)
      setCoinTypeInfo(null)
      setCommunityLinks([])
      return
    }
    let cancelled = false
    const loadTax = async () => {
      try {
        const res = await fetch(
          `https://api.honeypot.is/v2/IsHoneypot?address=${encodeURIComponent(address)}&chainID=${chainId}`,
        )
        if (!res.ok) throw new Error('honeypot api failed')
        const json = (await res.json()) as {
          simulationResult?: { buyTax?: number; sellTax?: number }
          token?: { buyTax?: number; sellTax?: number; totalSupply?: string }
        }
        if (cancelled) return
        const b = json?.simulationResult?.buyTax ?? json?.token?.buyTax
        const s = json?.simulationResult?.sellTax ?? json?.token?.sellTax
        setBuyTax(Number.isFinite(b as number) ? Number(b) : null)
        setSellTax(Number.isFinite(s as number) ? Number(s) : null)
        const ts = json?.token?.totalSupply
        setTotalSupply(typeof ts === 'string' && ts.trim() ? ts : null)
        setCoinTypeInfo(`${chain.toUpperCase()} · ${detailVM?.symbol ?? ''}`.trim())
      } catch {
        if (cancelled) return
        setBuyTax(null)
        setSellTax(null)
        setApiTotalHolders(null)
        setRealHolders([])
        setTotalSupply(null)
        setCoinTypeInfo(null)
      }
    }
    void loadTax()
    return () => { cancelled = true }
  }, [securityChain, securityAddress, detailVM?.symbol])

  useEffect(() => {
    const chain = securityChain
    const address = securityAddress
    if (!chain || !address) {
      setApiTotalHolders(null)
      setRealHolders([])
      return
    }
    const chainId = chainToHoneypotId[chain]
    if (!chainId) {
      setApiTotalHolders(null)
      setRealHolders([])
      return
    }
    let cancelled = false
    const loadHolders = async () => {
      try {
        const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(address)}`
        const res = await fetch(url)
        if (!res.ok) throw new Error('goplus api failed')
        const json = (await res.json()) as {
          result?: Record<string, {
            holder_count?: string
            total_supply?: string
            token_name?: string
            token_symbol?: string
            holders?: Array<{ address?: string; percent?: string; balance?: string }>
          }>
        }
        const key = address.toLowerCase()
        const payload = json?.result?.[key] ?? json?.result?.[address]
        if (!payload || cancelled) return
        const holderCountNum = Number.parseInt(String(payload.holder_count ?? ''), 10)
        setApiTotalHolders(Number.isFinite(holderCountNum) ? holderCountNum : null)
        const parsed = (payload.holders ?? [])
          .filter((x) => x && typeof x.address === 'string')
          .map((x) => ({
            address: String(x.address),
            percent: Number.parseFloat(String(x.percent ?? '0')) * 100,
            balance: String(x.balance ?? ''),
          }))
          .filter((x) => Number.isFinite(x.percent) && x.percent >= 0)
        setRealHolders(parsed.slice(0, 100))
        if (!totalSupply && payload.total_supply) setTotalSupply(String(payload.total_supply))
        if (!coinTypeInfo && (payload.token_symbol || payload.token_name)) {
          setCoinTypeInfo(`${chain.toUpperCase()} · ${payload.token_symbol ?? detailVM?.symbol ?? ''}`.trim())
        }
      } catch {
        if (cancelled) return
        setApiTotalHolders(null)
        setRealHolders([])
      }
    }
    void loadHolders()
    return () => { cancelled = true }
  }, [securityChain, securityAddress, totalSupply, coinTypeInfo, detailVM?.symbol])

  useEffect(() => {
    if (!detail) return
    const links: Array<{ label: string; url: string }> = []
    const homepage = detail.links?.homepage?.find((x) => typeof x === 'string' && x.trim().startsWith('http'))
    if (homepage) links.push({ label: '官网', url: homepage })
    const twitter = detail.links?.twitter_screen_name
    if (twitter) links.push({ label: 'Twitter', url: `https://x.com/${twitter}` })
    const tg = detail.links?.telegram_channel_identifier
    if (tg) links.push({ label: 'Telegram', url: `https://t.me/${tg}` })
    const reddit = detail.links?.subreddit_url
    if (reddit && reddit.startsWith('http')) links.push({ label: 'Reddit', url: reddit })
    setCommunityLinks(links)
    if (!totalSupply && detail.market_data?.total_supply != null) {
      setTotalSupply(String(detail.market_data.total_supply))
    }
    if (!coinTypeInfo) {
      const platform = detail.asset_platform_id || Object.entries(detail.platforms ?? {}).find(([, v]) => !!v)?.[0]
      setCoinTypeInfo(platform ? `${platform.toUpperCase()} · ${detail.symbol?.toUpperCase() ?? ''}` : (detail.symbol?.toUpperCase() ?? null))
    }
  }, [detail, totalSupply, coinTypeInfo])

  const buyTaxLabel = useMemo(() => {
    if (buyTax == null || buyTax <= 0) return null
    return `税${buyTax.toFixed(2).replace(/\.00$/, '')}%`
  }, [buyTax])

  const sellTaxLabel = useMemo(() => {
    if (sellTax == null || sellTax <= 0) return null
    return `税${sellTax.toFixed(2).replace(/\.00$/, '')}%`
  }, [sellTax])

  const volume24hValue = (detailVM?.volume24h ?? 0) > 0 ? (detailVM?.volume24h ?? 0) : (fourSnapshot?.volumeUsd ?? pairVolume24h ?? 0)
  const txns24hValue = pairTxns24h ?? (volume24hValue > 0 ? Math.round(volume24hValue / 4200) : 0)
  const totalSupplyNum = fourSnapshot?.totalSupply ?? (totalSupply ? (Number.parseFloat(totalSupply) || 0) : 0)
  const derivedFourLiquidityUsd =
    (fourSnapshot?.virtualLiquidityUsd ?? 0) > 0
      ? Number(fourSnapshot?.virtualLiquidityUsd ?? 0)
      : (detailVM?.marketCap ?? 0) > 0
        ? Number(detailVM?.marketCap ?? 0)
        : (detailVM?.price ?? 0) > 0 && totalSupplyNum > 0
          ? Number(detailVM?.price ?? 0) * totalSupplyNum
          : (volume24hValue > 0 ? volume24hValue : 0)
  const remainingSupplyNum = fourSnapshot?.remainingSupply ?? 0
  const hasFourReserveData =
    fourSnapshot != null &&
    (
      remainingSupplyNum > 0 ||
      fourSnapshot?.bondingQuoteAmount != null
    )
  const bondingQuoteAmountNum = fourSnapshot?.bondingQuoteAmount ?? 0
  const targetQuoteAmountNum = fourSnapshot?.targetQuoteAmount ?? 0
  const quoteSymbol = fourSnapshot?.quoteSymbol || 'BNB'
  const routeDisplayPrice = fourSnapshot?.marketCapUsd != null && totalSupplyNum > 0
    ? fourSnapshot.marketCapUsd / totalSupplyNum
    : detailVM?.price ?? 0
  const routeChange24h = fourSnapshot?.priceChange24h ?? detailVM?.change24h ?? 0
  const detailChangeTone = routeChange24h >= 0
    ? (redUpGreenDown ? 'down' : 'up')
    : (redUpGreenDown ? 'up' : 'down')
  const holderCountValue = apiTotalHolders && apiTotalHolders > 0 ? apiTotalHolders : null
  const effectiveIsFourSource = isFourSource
  const displayDexIdRaw = pairDexId ?? (routeSource || null)
  const displayDexId = effectiveIsFourSource ? 'four.meme' : (displayDexIdRaw === 'four' ? 'four.meme' : displayDexIdRaw)
  const displayPools = useMemo(() => {
    if (effectiveIsFourSource && detailVM) {
      return [
        {
          pairAddress: dexPairAddress ?? dexTokenAddress ?? coinId,
          dexId: 'four.meme',
          topSymbol: detailVM.symbol?.toUpperCase() ?? 'TOKEN',
          bottomSymbol: quoteSymbol,
          topAmount: remainingSupplyNum > 0 ? remainingSupplyNum : 0,
          bottomAmount: bondingQuoteAmountNum > 0 ? bondingQuoteAmountNum : targetQuoteAmountNum,
          feeLabel: '内盘',
          liquidityUsd: derivedFourLiquidityUsd,
          volume24h: Number(volume24hValue ?? 0) || 0,
          topAmountText:
            hasFourReserveData && remainingSupplyNum >= 0
              ? `${formatTokenAmount(remainingSupplyNum)} ${detailVM.symbol?.toUpperCase() ?? 'TOKEN'}`
              : '数量待同步',
          bottomAmountText:
            fourSnapshot?.bondingQuoteAmount != null
              ? `${formatTokenAmount(bondingQuoteAmountNum)} ${quoteSymbol}`
              : `${quoteSymbol} 同步中`,
          liquidityText: derivedFourLiquidityUsd > 0 ? formatCompact(derivedFourLiquidityUsd) : '内盘同步中',
        },
      ]
    }
    return tokenPools
  }, [tokenPools, effectiveIsFourSource, detailVM, dexPairAddress, dexTokenAddress, coinId, volume24hValue, derivedFourLiquidityUsd, remainingSupplyNum, bondingQuoteAmountNum, targetQuoteAmountNum, quoteSymbol, hasFourReserveData])
  const pairDexIcon = displayDexId ? DEX_ICON_MAP[displayDexId.toLowerCase()] : null
  const totalPoolsLiquidity = useMemo(
    () => displayPools.reduce((sum, p) => sum + (Number.isFinite(p.liquidityUsd) ? p.liquidityUsd : 0), 0),
    [displayPools],
  )
  const totalPoolsLiquidityLabel = effectiveIsFourSource && derivedFourLiquidityUsd > 0
    ? formatCompact(derivedFourLiquidityUsd)
    : formatCompact(totalPoolsLiquidity)

  useEffect(() => {
    setTokenLogoSrc(detailVM?.image ?? '')
  }, [detailVM?.image])

  if (!coinId || (!isDexFormat && !isCoingeckoFormat)) {
    return (
      <div className="page ave-page">
        <p className="error">{!coinId ? '缺少代币信息' : '代币 ID 格式无效'}</p>
      </div>
    )
  }

  if (loading && !detail && !dexItem) {
    return (
      <div className="page ave-page">
        <p className="ave-loading">加载中…</p>
      </div>
    )
  }

  if (error || (!detail && !dexItem)) {
    return (
      <div className="page ave-page">
        <p className="error">{error ?? '未找到该代币'}</p>
      </div>
    )
  }
  if (!detailVM) return null

  return (
    <div className="page ave-page market-detail-page">
      <section className="ave-detail-shell ave-detail-v2">
        <div className="ave-detail-topbar">
          <button
            type="button"
            className="ave-detail-icon-btn"
            aria-label="返回"
            onClick={() => navigate(-1)}
          >
            ‹
          </button>
          <div className="ave-detail-token-meta">
            {tokenLogoSrc ? (
              <img
                src={tokenLogoSrc}
                alt=""
                className="ave-detail-avatar"
                onError={() => setTokenLogoSrc('')}
              />
            ) : (
              <div className="ave-detail-avatar-fallback" aria-hidden="true">
                {(detailVM.symbol || '?').slice(0, 1)}
              </div>
            )}
            <div className="ave-detail-token-copy">
              <div className="ave-detail-token-name">{detailVM.name}</div>
              <div className="ave-detail-token-sub">{tokenContractLine}</div>
            </div>
          </div>
          <div className="ave-detail-top-icons">
            <button type="button" className="ave-detail-icon-btn" onClick={() => setMainTab('risk')}>◦</button>
            <button
              type="button"
              className={`ave-detail-icon-btn ${isFavorite ? 'active' : ''}`}
              onClick={() => setIsFavorite((v) => !v)}
            >
              {isFavorite ? '★' : '☆'}
            </button>
            <button
              type="button"
              className="ave-detail-icon-btn"
              onClick={async () => {
                const sharePayload = {
                  title: `${detailVM.name} 行情`,
                  text: `${detailVM.name} ${formatPriceByCurrency(routeDisplayPrice, currencyUnit)}`,
                  url: window.location.href,
                }
                try {
                  if (navigator.share) await navigator.share(sharePayload)
                  else await navigator.clipboard.writeText(window.location.href)
                } catch {
                  // user cancelled share
                }
              }}
            >
              ↗
            </button>
            <button
              type="button"
              className={`ave-detail-icon-btn ${showMoreMenu ? 'active' : ''}`}
              onClick={() => setShowMoreMenu((v) => !v)}
            >
              ⋯
            </button>
          </div>
        </div>
        {showMoreMenu && (
          <div className="ave-detail-more-menu">
            <button type="button" onClick={() => window.location.reload()}>刷新数据</button>
            <button type="button" onClick={() => navigate('/market')}>返回行情列表</button>
          </div>
        )}

        <div className="ave-detail-main-tabs">
          <button type="button" className={mainTab === 'market' ? 'active' : ''} onClick={() => setMainTab('market')}>行情</button>
          <button type="button" className={mainTab === 'holders' ? 'active' : ''} onClick={() => setMainTab('holders')}>持币人 {holderCountValue ? formatInt(holderCountValue) : '—'}</button>
          <button type="button" className={mainTab === 'detail' ? 'active' : ''} onClick={() => setMainTab('detail')}>详情</button>
          <button type="button" className={mainTab === 'feed' ? 'active' : ''} onClick={() => setMainTab('feed')}>动态</button>
          <button type="button" className={mainTab === 'risk' ? 'active' : ''} onClick={() => setMainTab('risk')}>风险</button>
        </div>

        <div className="ave-detail-price-panel">
          <div className="ave-detail-price-left">
            <div className="ave-detail-big-price">{formatPriceByCurrency(routeDisplayPrice, currencyUnit)}</div>
            <div className={`ave-detail-change ${detailChangeTone}`}>
              {routeChange24h >= 0 ? '+' : ''}{routeChange24h.toFixed(2)}%
            </div>
          </div>
          <div className="ave-detail-price-right">
            <div><span>流通市值</span><strong>{formatCurrencyCompact(fourSnapshot?.marketCapUsd ?? detailVM.marketCap, currencyUnit)}</strong></div>
            <div><span>24h成交量</span><strong>{formatCurrencyCompact(volume24hValue, currencyUnit)}</strong></div>
            <div><span>24h持币数</span><strong>{holderCountValue ? formatInt(holderCountValue) : '—'}</strong></div>
            <div><span>24h交易数</span><strong>{formatInt(txns24hValue)}</strong></div>
          </div>
        </div>
        <div className="ave-detail-v2-data-cards">
          <div className="ave-detail-v2-data-card">
            <span>流通市值</span>
            <strong>{formatCurrencyCompact(fourSnapshot?.marketCapUsd ?? detailVM.marketCap, currencyUnit)}</strong>
          </div>
          <div className="ave-detail-v2-data-card">
            <span>24h成交量</span>
            <strong>{formatCurrencyCompact(volume24hValue, currencyUnit)}</strong>
          </div>
          <div className="ave-detail-v2-data-card">
            <span>持币人数</span>
            <strong>{holderCountValue ? formatInt(holderCountValue) : '—'}</strong>
          </div>
          <div className="ave-detail-v2-data-card">
            <span>24h交易数</span>
            <strong>{formatInt(txns24hValue)}</strong>
          </div>
        </div>

        {mainTab === 'market' && (
          <>
            <div className="ave-detail-toolbar">
              <button type="button" className={toolMode === '1s' ? 'active' : ''} onClick={() => setToolMode('1s')}>1s</button>
              <button type="button" className={toolMode === 'user' ? 'active' : ''} onClick={() => setToolMode('user')}>👤</button>
              <button type="button" className={toolMode === 'global' ? 'active' : ''} onClick={() => setToolMode('global')}>🌐</button>
              <button type="button" className={toolMode === 'search' ? 'active' : ''} onClick={() => setToolMode('search')}>🔍</button>
            </div>

            <div className="ave-detail-period-row">
              <div className="ave-detail-period-tabs">
                {[
                  { key: '1m' as const, label: '1分' },
                  { key: '5m' as const, label: '5分' },
                  { key: '15m' as const, label: '15分' },
                  { key: '1h' as const, label: '1时' },
                  { key: '4h' as const, label: '4时' },
                  { key: '1d' as const, label: '1日' },
                  { key: '1w' as const, label: '1周' },
                ].map((item) => (
                  <button key={item.key} type="button" className={period === item.key ? 'active' : ''} onClick={() => setPeriod(item.key)}>
                    {item.label}
                  </button>
                ))}
                <span className="ave-detail-period-title">价格</span>
              </div>
              <div className="ave-detail-period-actions">
                <button type="button">◫</button>
                <button type="button">⚙</button>
              </div>
            </div>
            <div className="ave-detail-chart-indicators">
              <span className={indicator === 'EMA' ? 'active' : ''}>EMA5:{formatPrice(detailVM.price * 0.94)}</span>
              <span>EMA10:{formatPrice(detailVM.price * 0.98)}</span>
              <span>EMA20:{formatPrice(detailVM.price * 1.01)}</span>
            </div>

            <div className="ave-detail-chart-card">
              <KLineChart
                syntheticData={{ currentPrice: detailVM.price, change24h: detailVM.change24h ?? 0 }}
                geckoPool={geckoNetworkId && dexPairAddress ? { network: geckoNetworkId, poolAddress: dexPairAddress } : undefined}
                dexScreener={dexScreenerChainId && dexTokenAddress ? { chainId: dexScreenerChainId, tokenAddress: dexTokenAddress } : undefined}
                period={period}
              />
            </div>

            <div className="ave-detail-pool-section">
              <div className="ave-detail-subtabs">
                <button type="button" className={subTab === 'trade' ? 'active' : ''} onClick={() => setSubTab('trade')}>交易</button>
                <button type="button" className={subTab === 'pool' ? 'active' : ''} onClick={() => setSubTab('pool')}>池子</button>
                <button type="button" className={subTab === 'mine' ? 'active' : ''} onClick={() => setSubTab('mine')}>我的</button>
                <button type="button" className={subTab === 'orders' ? 'active' : ''} onClick={() => setSubTab('orders')}>挂单</button>
                <button type="button" className={subTab === 'watch' ? 'active' : ''} onClick={() => setSubTab('watch')}>关注</button>
                <button type="button" className={subTab === 'creator' ? 'active' : ''} onClick={() => setSubTab('creator')}>创建者</button>
              </div>
              <div className="ave-detail-liquidity-card">
                {subTab === 'trade' && (
                  <div className="ave-tab-placeholder">
                    <p>最新成交（实时）</p>
                    <div className="trade-recent-list">
                      {recentTrades.length > 0 ? recentTrades.slice(0, 100).map((t, i) => (
                        <div key={`${t.txHash}-${i}`} className="trade-row">
                          <span className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? '买' : '卖'}</span>
                          <span>${t.volumeUsd.toFixed(2)}</span>
                          <span>{t.from ? `${t.from.slice(0, 6)}...${t.from.slice(-4)}` : '—'}</span>
                        </div>
                      )) : <span className="trade-empty">暂无买卖成交数据</span>}
                    </div>
                  </div>
                )}
                {subTab !== 'trade' && (
                  <>
                    <div className="ave-liquidity-title">
                      <span>总流动性</span>
                      <strong>{totalPoolsLiquidityLabel}</strong>
                    </div>
                    {effectiveIsFourSource && subTab === 'pool' && (
                      <div className="ave-four-pool-summary">
                        <div>
                          <span>币种数量</span>
                          <strong>
                            {hasFourReserveData
                              ? `${formatTokenAmount(remainingSupplyNum)} ${detailVM.symbol?.toUpperCase() ?? 'TOKEN'}`
                              : '数量待同步'}
                          </strong>
                        </div>
                        <div>
                          <span>{quoteSymbol} 数量</span>
                          <strong>
                            {bondingQuoteAmountNum > 0
                              || fourSnapshot?.bondingQuoteAmount === 0
                              ? `${formatTokenAmount(bondingQuoteAmountNum)} ${quoteSymbol}`
                              : `${quoteSymbol} 同步中`}
                          </strong>
                        </div>
                        <div>
                          <span>流动性总额</span>
                          <strong>
                            {derivedFourLiquidityUsd > 0
                              ? formatCompact(derivedFourLiquidityUsd)
                              : ((detailVM?.marketCap ?? 0) > 0 ? formatCompact(detailVM.marketCap ?? 0) : '内盘同步中')}
                          </strong>
                        </div>
                      </div>
                    )}
                    {subTab === 'pool' ? (
                      <div className="trade-recent-list">
                        <div className="ave-pool-table-head">
                          <span>池子配对</span>
                          <span>币种数量</span>
                          <span>DEX</span>
                          <span>流动性总额</span>
                        </div>
                        {displayPools.length > 0 ? displayPools.map((pool, idx) => {
                          const icon = DEX_ICON_MAP[pool.dexId.toLowerCase()] || null
                          const active = dexPairAddress === pool.pairAddress
                          return (
                            <button
                              key={`${pool.pairAddress}-${idx}`}
                              type="button"
                              className="ave-liquidity-row ave-liquidity-row-pool ave-pool-table-row"
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                background: active ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                                border: active ? '1px solid rgba(56, 189, 248, 0.55)' : '1px solid transparent',
                                borderRadius: 10,
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                setDexPairAddress(pool.pairAddress ?? null)
                                setPairDexId(pool.dexId ?? null)
                              }}
                              title="站内打开该池子"
                            >
                              <span className="ave-pool-pair-cell">
                                <span className="ave-pool-pair-top">
                                  <span>{pool.topSymbol}</span>
                                  {pool.feeLabel && <em>{pool.feeLabel}</em>}
                                </span>
                                <span className="ave-pool-pair-bottom">{pool.bottomSymbol}</span>
                              </span>
                              <span className="ave-pool-amount-cell">
                                <span>{(pool as any).topAmountText ?? formatTokenAmount(pool.topAmount)}</span>
                                <span>{(pool as any).bottomAmountText ?? formatTokenAmount(pool.bottomAmount)}</span>
                              </span>
                              <span className="ave-pool-dex-cell">
                                <span className="ave-pool-dex-badge">
                                  {icon ? <img src={icon} alt={pool.dexId} /> : <i>{pool.dexId.slice(0, 3).toUpperCase()}</i>}
                                </span>
                              </span>
                              <span>{(pool as any).liquidityText ?? formatCompact(pool.liquidityUsd)}</span>
                            </button>
                          )
                        }) : <span className="trade-empty">暂无池子数据</span>}
                      </div>
                    ) : (
                      <div className="ave-tab-placeholder">
                        <p>{subTab === 'mine' ? '我的池子' : subTab === 'orders' ? '挂单池子' : subTab === 'watch' ? '关注池子' : '创建者池子'}</p>
                        <span>当前共检测到 {displayPools.length} 个 DEX 池子</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {mainTab !== 'market' && (
          <>
            <div className="ave-detail-indicator-tabs">
              {(['MA', 'EMA', 'BOLL', 'VOL', 'MACD', 'KDJ', 'RSI'] as const).map((it) => (
                <button key={it} type="button" className={it === indicator ? 'active' : ''} onClick={() => setIndicator(it)}>{it}</button>
              ))}
            </div>
            {mainTab === 'holders' && (
              <div className="ave-detail-panel-placeholder holders-panel">
                <p>持币人前 100 名</p>
                <span>总持币人数：{holderCountValue ? formatInt(holderCountValue) : '—'}</span>
                <div className="holders-table-head">
                  <span>排名</span>
                  <span>地址</span>
                  <span>占比</span>
                  <span>余额</span>
                </div>
                <div className="holders-table-body">
                  {Array.from({ length: 100 }, (_, idx) => {
                    const row = realHolders[idx]
                    return (
                      <div key={idx + 1} className="holders-row">
                        <span>#{idx + 1}</span>
                        <span>{row ? `${row.address.slice(0, 8)}...${row.address.slice(-6)}` : '—'}</span>
                        <span>{row ? `${row.percent.toFixed(4)}%` : '—'}</span>
                        <span>{row && row.balance ? Number.parseFloat(row.balance).toLocaleString('en-US') : '—'}</span>
                      </div>
                    )
                  })}
                </div>
                {realHolders.length > 0 ? (
                  <>
                    <span className="holders-note">当前数据源返回 {realHolders.length} 名真实持币人，未返回的名次不展示。</span>
                  </>
                ) : (
                  <span className="holders-note">暂无真实持币人明细数据。</span>
                )}
              </div>
            )}
            {mainTab === 'detail' && (
              <div className="ave-detail-panel-placeholder detail-panel">
                <p>代币详情</p>
                <div className="detail-grid">
                  <div><span>名称</span><strong>{detailVM.name}</strong></div>
                  <div className="ave-detail-v2-contract"><span>合约</span><strong>{dexTokenAddress ? `${dexTokenAddress.slice(0, 8)}...${dexTokenAddress.slice(-6)}` : '—'}</strong></div>
                  <div><span>总量</span><strong>{totalSupply ? Number.parseFloat(totalSupply).toLocaleString('en-US') : '—'}</strong></div>
                  <div><span>币种信息</span><strong>{coinTypeInfo ?? '—'}</strong></div>
                  <div className="detail-links">
                    <span>社区链接</span>
                    {communityLinks.length > 0 ? (
                      <strong>
                        {communityLinks.map((item) => (
                          <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
                        ))}
                      </strong>
                    ) : (
                      <strong>—</strong>
                    )}
                  </div>
                </div>
              </div>
            )}
            {mainTab === 'feed' && (
              <div className="ave-detail-panel-placeholder">
                <p>动态</p>
                <span>暂无链上动态流，后续可接入推文与地址异动事件。</span>
              </div>
            )}
            {mainTab === 'risk' && (
              <div className="ave-detail-panel-placeholder">
                <p>风险</p>
                <span>买税：{buyTaxLabel ?? '无'} ｜ 卖税：{sellTaxLabel ?? '无'} ｜ 24h交易数：{formatInt(txns24hValue)}</span>
              </div>
            )}
          </>
        )}

        <div className="ave-detail-bottom-cta">
          <button
            type="button"
            className="dapp"
            onClick={() => navigate('/bot')}
            aria-label={displayDexId ? `打开 ${displayDexId}` : '打开 DApp'}
            title={displayDexId ?? 'DApp'}
          >
            {pairDexIcon ? (
              <img src={pairDexIcon} alt={displayDexId ?? 'dex'} />
            ) : (
              <span>{displayDexId ? displayDexId.slice(0, 4).toUpperCase() : 'DEX'}</span>
            )}
          </button>
          <Link to={quickTradeTargets.buy} className="buy">买入{buyTaxLabel && <div>{buyTaxLabel}</div>}</Link>
          <Link to={quickTradeTargets.sell} className="sell">卖出{sellTaxLabel && <div>{sellTaxLabel}</div>}</Link>
        </div>
      </section>
    </div>
  )
}
