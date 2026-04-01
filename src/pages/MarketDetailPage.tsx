import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import axios from 'axios'
import { KLineChart, type KLinePeriod } from '../components/KLineChart'
import { type MarketItem, fetchDexTokenById } from '../api/markets'

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

export function MarketDetailPage() {
  const { coinId } = useParams<{ coinId: string }>()
  const [detail, setDetail] = useState<CoinDetail | null>(null)
  const [dexItem, setDexItem] = useState<MarketItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<KLinePeriod>('1h')
  const [dexPairAddress, setDexPairAddress] = useState<string | null>(null)

  const isDexFormat = coinId && DEX_ID_REG.test(coinId)
  const isCoingeckoFormat = coinId && COINGECKO_ID_REG.test(coinId)

  const dexTokenAddress = useMemo(() => {
    if (!dexItem?.id) return null
    return dexItem.id.split(':')[1] ?? null
  }, [dexItem?.id])

  const quickTradeTargets = useMemo(() => {
    if (dexItem) {
      const symbol = dexItem.symbol?.toUpperCase() ?? ''
      const addr = dexTokenAddress ?? ''
      return {
        buy: `/swap?from=USDC&to=${encodeURIComponent(symbol)}&toAddr=${encodeURIComponent(addr)}&amount=50`,
        sell: `/swap?from=${encodeURIComponent(symbol)}&fromAddr=${encodeURIComponent(addr)}&to=USDC&amount=50`,
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
    // MarketItem.chain 约定：eth/bsc/base/sol/polygon
    if (dexItem.chain === 'eth') return 'ethereum'
    if (dexItem.chain === 'sol') return 'solana'
    return dexItem.chain
  }, [dexItem])

  const geckoNetworkId = useMemo(() => {
    if (!dexItem) return null
    if (dexItem.chain === 'eth') return 'eth'
    if (dexItem.chain === 'polygon') return 'polygon_pos'
    if (dexItem.chain === 'sol') return 'solana'
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

  if (dexItem) {
    const price = dexItem.current_price
    const change24h = dexItem.price_change_percentage_24h ?? 0
    const cap = dexItem.market_cap ?? 0

    const formatCompact = (value: number) => {
      if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
      if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
      if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
      return `$${value.toFixed(2)}`
    }

    return (
      <div className="page ave-page">
        <div className="card market-detail-card">
          <section className="market-detail-hero">
            <div className="market-detail-header">
              <img src={dexItem.image || ''} alt="" className="market-detail-icon" />
              <div className="market-detail-summary">
                <h1 className="market-detail-name">{dexItem.symbol?.toUpperCase() ?? dexItem.symbol}</h1>
                <span className="market-detail-symbol">{dexItem.symbol?.toUpperCase()} · 实时概览</span>
              </div>
            </div>
            <div className="market-detail-price">
              ${price >= 1 ? price.toFixed(2) : price.toFixed(6)}
            </div>
            <div className={`market-detail-change ${change24h >= 0 ? 'up' : 'down'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}% (24h)
            </div>
            {cap > 0 && (
              <div className="market-detail-cap">市值 {formatCompact(cap)}</div>
            )}
            <div className="market-detail-actions">
              <Link to={quickTradeTargets.buy} className="btn-primary market-detail-action">快捷买</Link>
              <Link to={quickTradeTargets.sell} className="btn-ghost market-detail-action">快捷卖</Link>
              <Link to="/swap" className="btn-ghost market-detail-action">高级交易</Link>
              <Link to="/wallet" className="btn-ghost market-detail-action">查看钱包</Link>
            </div>
          </section>
          <div className="market-detail-chart">
            <div className="detail-chip-row">
              {[
                { key: '1m' as const, label: '1m' },
                { key: '5m' as const, label: '5m' },
                { key: '30m' as const, label: '30m' },
                { key: '1h' as const, label: '1H' },
                { key: '2h' as const, label: '2H' },
                { key: '1d' as const, label: '1D' },
                { key: '1w' as const, label: '1W' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`detail-chip ${period === item.key ? 'active' : ''}`}
                  onClick={() => setPeriod(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <KLineChart
              syntheticData={{ currentPrice: price, change24h }}
              geckoPool={geckoNetworkId && dexPairAddress ? { network: geckoNetworkId, poolAddress: dexPairAddress } : undefined}
              dexScreener={dexScreenerChainId && dexTokenAddress ? { chainId: dexScreenerChainId, tokenAddress: dexTokenAddress } : undefined}
              period={period}
            />
          </div>
        </div>
      </div>
    )
  }

  if (!detail) return null
  const md = detail.market_data
  const price = md?.current_price?.usd ?? 0
  const change24h = md?.price_change_percentage_24h ?? 0
  const cap = md?.market_cap?.usd ?? 0
  const volume = md?.total_volume?.usd ?? 0
  const high = md?.high_24h?.usd ?? 0
  const low = md?.low_24h?.usd ?? 0
  const fdv = md?.fully_diluted_valuation?.usd ?? 0

  const formatCompact = (value: number) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
    return `$${value.toFixed(2)}`
  }

  return (
    <div className="page ave-page">
      <div className="card market-detail-card">
        <section className="market-detail-hero">
          <div className="market-detail-header">
            <img
              src={detail.image?.large ?? detail.image?.small}
              alt=""
              className="market-detail-icon"
            />
            <div className="market-detail-summary">
              <h1 className="market-detail-name">{detail.symbol?.toUpperCase() ?? detail.symbol}</h1>
              <span className="market-detail-symbol">{detail.symbol?.toUpperCase()} · 实时概览</span>
            </div>
          </div>
          <div className="market-detail-price">
            ${price >= 1 ? price.toFixed(2) : price.toFixed(6)}
          </div>
          <div className={`market-detail-change ${change24h >= 0 ? 'up' : 'down'}`}>
            {change24h >= 0 ? '+' : ''}{change24h?.toFixed(2)}% (24h)
          </div>
          {cap > 0 && (
            <div className="market-detail-cap">
              市值 {formatCompact(cap)}
            </div>
          )}
          <div className="market-detail-stats">
            <div className="stat-card">
              <div className="stat-label">24h 成交额</div>
              <div className="stat-value">{formatCompact(volume)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">FDV</div>
              <div className="stat-value">{fdv > 0 ? formatCompact(fdv) : '—'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">24h 最高</div>
              <div className="stat-value">{high > 0 ? formatCompact(high) : '—'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">24h 最低</div>
              <div className="stat-value">{low > 0 ? formatCompact(low) : '—'}</div>
            </div>
          </div>
          <div className="market-detail-actions">
            <Link to={quickTradeTargets.buy} className="btn-primary market-detail-action">快捷买</Link>
            <Link to={quickTradeTargets.sell} className="btn-ghost market-detail-action">快捷卖</Link>
            <Link to="/swap" className="btn-ghost market-detail-action">高级交易</Link>
            <Link to="/wallet" className="btn-ghost market-detail-action">查看钱包</Link>
          </div>
        </section>
        <div className="market-detail-chart">
          <div className="detail-chip-row">
            {[
              { key: '1m' as const, label: '1m' },
              { key: '5m' as const, label: '5m' },
              { key: '30m' as const, label: '30m' },
              { key: '1h' as const, label: '1H' },
              { key: '2h' as const, label: '2H' },
              { key: '1d' as const, label: '1D' },
              { key: '1w' as const, label: '1W' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`detail-chip ${period === item.key ? 'active' : ''}`}
                onClick={() => setPeriod(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <KLineChart
            syntheticData={{ currentPrice: price, change24h: change24h ?? 0 }}
            period={period}
          />
        </div>
      </div>
    </div>
  )
}
