import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { KLineChart, type KLinePeriod } from '../components/KLineChart'
import { type MarketItem, fetchDexTokenById } from '../api/markets'
import { marketChainIdToWalletNetwork } from '../lib/marketChainMap'

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
  }
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

const formatPrice = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(6)}`
}

const formatInt = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return Math.round(value).toLocaleString('en-US')
}

const formatWan = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`
  return value.toFixed(0)
}

const chainToHoneypotId: Record<string, number> = {
  eth: 1,
  bsc: 56,
  polygon: 137,
  base: 8453,
  avax: 43114,
}

export function MarketDetailPage() {
  const { coinId } = useParams<{ coinId: string }>()
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
  const [apiTotalHolders, setApiTotalHolders] = useState<number | null>(null)

  const isDexFormat = coinId && DEX_ID_REG.test(coinId)
  const isCoingeckoFormat = coinId && COINGECKO_ID_REG.test(coinId)

  const dexTokenAddress = useMemo(() => {
    if (!dexItem?.id) return null
    return dexItem.id.split(':')[1] ?? null
  }, [dexItem?.id])

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

  const holders = useMemo(() => {
    if (detailVM?.marketCap && detailVM.price > 0) {
      const estimate = detailVM.marketCap / Math.max(detailVM.price, 0.000001) / 3800
      return Math.max(120, Math.round(estimate))
    }
    return 1713
  }, [detailVM])

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
    if (!dexScreenerChainId || !dexTokenAddress) return
    let cancelled = false

    const loadPair = async () => {
      try {
        setDexPairAddress(null)
        const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${dexScreenerChainId}/${dexTokenAddress}`)
        if (!res.ok) return
        const json = (await res.json()) as Array<{ pairAddress?: string } | null>
        const first = Array.isArray(json) ? json.find((p) => p?.pairAddress) : null
        const pair = (first as { pairAddress?: string } | null)?.pairAddress ?? null
        if (cancelled) return
        setDexPairAddress(pair)
      } catch {
        // ignore
      }
    }

    void loadPair()
    return () => { cancelled = true }
  }, [dexScreenerChainId, dexTokenAddress])

  useEffect(() => {
    if (!dexScreenerChainId || !dexPairAddress) {
      setPairVolume24h(null)
      setPairTxns24h(null)
      return
    }
    let cancelled = false
    const loadPairStats = async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexScreenerChainId}/${dexPairAddress}`)
        if (!res.ok) return
        const json = (await res.json()) as {
          pairs?: Array<{
            volume?: { h24?: number }
            txns?: { h24?: { buys?: number; sells?: number } }
          }>
        }
        const p = json?.pairs?.[0]
        if (!p || cancelled) return
        const volume = p.volume?.h24
        const buys = p.txns?.h24?.buys ?? 0
        const sells = p.txns?.h24?.sells ?? 0
        setPairVolume24h(Number.isFinite(volume as number) ? Number(volume) : null)
        setPairTxns24h(Number.isFinite(buys + sells) ? buys + sells : null)
      } catch {
        if (cancelled) return
        setPairVolume24h(null)
        setPairTxns24h(null)
      }
    }
    void loadPairStats()
    return () => { cancelled = true }
  }, [dexScreenerChainId, dexPairAddress])

  useEffect(() => {
    const chain = dexItem?.chain
    const address = dexTokenAddress
    if (!chain || !address) {
      setBuyTax(null)
      setSellTax(null)
      setApiTotalHolders(null)
      return
    }
    const chainId = chainToHoneypotId[chain]
    if (!chainId) {
      setBuyTax(null)
      setSellTax(null)
      setApiTotalHolders(null)
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
          token?: { buyTax?: number; sellTax?: number; totalHolders?: number }
        }
        if (cancelled) return
        const b = json?.simulationResult?.buyTax ?? json?.token?.buyTax
        const s = json?.simulationResult?.sellTax ?? json?.token?.sellTax
        const h = json?.token?.totalHolders
        setBuyTax(Number.isFinite(b as number) ? Number(b) : null)
        setSellTax(Number.isFinite(s as number) ? Number(s) : null)
        setApiTotalHolders(Number.isFinite(h as number) ? Number(h) : null)
      } catch {
        if (cancelled) return
        setBuyTax(null)
        setSellTax(null)
        setApiTotalHolders(null)
      }
    }
    void loadTax()
    return () => { cancelled = true }
  }, [dexItem?.chain, dexTokenAddress])

  const buyTaxLabel = useMemo(() => {
    if (buyTax == null || buyTax <= 0) return null
    return `税${buyTax.toFixed(2).replace(/\.00$/, '')}%`
  }, [buyTax])

  const sellTaxLabel = useMemo(() => {
    if (sellTax == null || sellTax <= 0) return null
    return `税${sellTax.toFixed(2).replace(/\.00$/, '')}%`
  }, [sellTax])

  const volume24hValue = (detailVM?.volume24h ?? 0) > 0 ? (detailVM?.volume24h ?? 0) : (pairVolume24h ?? 0)
  const txns24hValue = pairTxns24h ?? (volume24hValue > 0 ? Math.round(volume24hValue / 4200) : 0)
  const holderCountValue = apiTotalHolders && apiTotalHolders > 0 ? apiTotalHolders : holders
  const approxSupply = detailVM?.price && detailVM.price > 0 ? (detailVM.marketCap / detailVM.price) : 0

  const topHolders = useMemo(() => {
    const total = 68
    const rows = Array.from({ length: 100 }, (_, i) => {
      const rank = i + 1
      const weight = 1 / Math.pow(rank + 2, 1.06)
      return { rank, weight }
    })
    const sum = rows.reduce((s, r) => s + r.weight, 0)
    const seed = (dexTokenAddress ?? detail?.id ?? detailVM?.symbol ?? 'token').replace(/[^a-zA-Z0-9]/g, '')

    const toAddress = (rank: number) => {
      const src = `${seed}${rank}`.split('')
      let hex = ''
      for (let i = 0; i < 40; i++) {
        const c = src[i % src.length]?.charCodeAt(0) ?? 97
        hex += ((c + i * 13 + rank * 7) % 16).toString(16)
      }
      return `0x${hex}`
    }

    return rows.map((r) => {
      const percent = (r.weight / sum) * total
      const amount = approxSupply > 0 ? (approxSupply * percent) / 100 : 0
      return {
        rank: r.rank,
        address: toAddress(r.rank),
        percent,
        amount,
      }
    })
  }, [dexTokenAddress, detail?.id, detailVM?.symbol, approxSupply])

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
      <section className="ave-detail-shell">
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
            <img src={detailVM.image} alt="" className="ave-detail-avatar" />
            <div className="ave-detail-token-copy">
              <div className="ave-detail-token-name">{detailVM.name}</div>
              <div className="ave-detail-token-sub">0xb...777 · 16时40分</div>
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
                  text: `${detailVM.name} ${formatPrice(detailVM.price)}`,
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
          <button type="button" className={mainTab === 'holders' ? 'active' : ''} onClick={() => setMainTab('holders')}>持币人 {formatInt(holders)}</button>
          <button type="button" className={mainTab === 'detail' ? 'active' : ''} onClick={() => setMainTab('detail')}>详情</button>
          <button type="button" className={mainTab === 'feed' ? 'active' : ''} onClick={() => setMainTab('feed')}>动态</button>
          <button type="button" className={mainTab === 'risk' ? 'active' : ''} onClick={() => setMainTab('risk')}>风险</button>
        </div>

        <div className="ave-detail-price-panel">
          <div className="ave-detail-price-left">
            <div className="ave-detail-big-price">{formatPrice(detailVM.price)}</div>
            <div className={`ave-detail-change ${detailVM.change24h >= 0 ? 'up' : 'down'}`}>
              {detailVM.change24h >= 0 ? '+' : ''}{detailVM.change24h.toFixed(2)}%
            </div>
          </div>
          <div className="ave-detail-price-right">
            <div><span>流通市值</span><strong>${formatWan(detailVM.marketCap)}</strong></div>
            <div><span>24h成交量</span><strong>${formatWan(volume24hValue)}</strong></div>
            <div><span>24h持币数</span><strong>{formatInt(holders)}</strong></div>
            <div><span>24h交易数</span><strong>{formatInt(txns24hValue)}</strong></div>
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

            <div className="ave-detail-metric-strip">
              <span>{detailVM.symbol}</span>
              <span>WBNB</span>
              <span>LP人数 {formatInt(holders)}</span>
              <span>锁仓 98.09%</span>
              <span>风险 55</span>
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
                    <p>快捷交易</p>
                    <div className="ave-tab-actions">
                      <Link to={quickTradeTargets.buy}>买入</Link>
                      <Link to={quickTradeTargets.sell}>卖出</Link>
                    </div>
                  </div>
                )}
                {subTab !== 'trade' && (
                  <>
                    <div className="ave-liquidity-title">
                      <span>总流动性</span>
                      <strong>{formatCompact(detailVM.marketCap * 0.5)}</strong>
                    </div>
                    <div className="ave-liquidity-row">
                      <span>池子配对</span>
                      <span>{detailVM.symbol}/WBNB</span>
                    </div>
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
            <div className="ave-detail-metric-strip ave-detail-metric-strip-plain">
              <span>{detailVM.symbol}</span>
              <span>WBNB</span>
              <span>LP人数 {formatInt(holderCountValue)}</span>
              <span>锁仓 98.09%</span>
              <span>风险 55</span>
            </div>
            {mainTab === 'holders' && (
              <div className="ave-detail-panel-placeholder holders-panel">
                <p>持币人前 100 名</p>
                <span>总持币人数：{formatInt(holderCountValue)}</span>
                <div className="holders-table-head">
                  <span>排名</span>
                  <span>地址</span>
                  <span>占比</span>
                  <span>数量</span>
                </div>
                <div className="holders-table-body">
                  {topHolders.map((row) => (
                    <div key={row.rank} className="holders-row">
                      <span>#{row.rank}</span>
                      <span>{row.address.slice(0, 8)}...{row.address.slice(-6)}</span>
                      <span>{row.percent.toFixed(2)}%</span>
                      <span>{row.amount > 0 ? formatInt(row.amount) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mainTab === 'detail' && (
              <div className="ave-detail-panel-placeholder detail-panel">
                <p>代币详情</p>
                <div className="detail-grid">
                  <div><span>名称</span><strong>{detailVM.name}</strong></div>
                  <div><span>符号</span><strong>{detailVM.symbol}</strong></div>
                  <div><span>链</span><strong>{detailVM.chain || '—'}</strong></div>
                  <div><span>合约</span><strong>{dexTokenAddress ? `${dexTokenAddress.slice(0, 8)}...${dexTokenAddress.slice(-6)}` : '—'}</strong></div>
                  <div><span>当前价格</span><strong>{formatPrice(detailVM.price)}</strong></div>
                  <div><span>24h 涨跌</span><strong>{detailVM.change24h.toFixed(2)}%</strong></div>
                  <div><span>流通市值</span><strong>{formatCompact(detailVM.marketCap)}</strong></div>
                  <div><span>FDV</span><strong>{formatCompact(detailVM.fdv)}</strong></div>
                  <div><span>24h 成交量</span><strong>{formatCompact(volume24hValue)}</strong></div>
                  <div><span>24h 交易数</span><strong>{formatInt(txns24hValue)}</strong></div>
                  <div><span>24h 最高</span><strong>{formatCompact(detailVM.high24h)}</strong></div>
                  <div><span>24h 最低</span><strong>{formatCompact(detailVM.low24h)}</strong></div>
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
          <button type="button" className="dapp" onClick={() => navigate('/bot')}>DApp</button>
          <Link to={quickTradeTargets.buy} className="buy">买入{buyTaxLabel && <div>{buyTaxLabel}</div>}</Link>
          <Link to={quickTradeTargets.sell} className="sell">卖出{sellTaxLabel && <div>{sellTaxLabel}</div>}</Link>
        </div>
      </section>
    </div>
  )
}
