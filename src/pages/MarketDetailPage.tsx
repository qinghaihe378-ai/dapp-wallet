import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  if (!detailVM) return null

  return (
    <div className="page ave-page market-detail-page">
      <div className="card market-detail-card ave-token-detail">
        <section className="market-detail-hero ave-token-detail-hero">
          <div className="market-detail-header ave-token-head">
            <div className="ave-token-identity">
              <img src={detailVM.image} alt="" className="market-detail-icon ave-token-icon" />
              <div className="market-detail-summary">
                <h1 className="market-detail-name">{detailVM.symbol}</h1>
                <span className="market-detail-symbol">
                  {detailVM.name}
                  {detailVM.chain && <em>{detailVM.chain}</em>}
                </span>
              </div>
            </div>
            <div className="ave-token-mini-actions">
              <button type="button" aria-label="关注">☆</button>
              <button type="button" aria-label="分享">↗</button>
            </div>
          </div>

          <div className="ave-token-price-wrap">
            <div className="market-detail-price">{formatPrice(detailVM.price)}</div>
            <div className={`market-detail-change ave-token-change ${detailVM.change24h >= 0 ? 'up' : 'down'}`}>
              {detailVM.change24h >= 0 ? '+' : ''}{detailVM.change24h.toFixed(2)}%
            </div>
          </div>

          <div className="ave-token-meta-row">
            <div className="market-detail-cap">市值 {formatCompact(detailVM.marketCap)}</div>
            <div className="ave-token-meta-divider" />
            <div className="market-detail-cap">24h 成交额 {formatCompact(detailVM.volume24h)}</div>
          </div>

          <div className="market-detail-stats ave-token-stats">
            <div className="stat-card">
              <div className="stat-label">24h 成交额</div>
              <div className="stat-value">{formatCompact(detailVM.volume24h)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">FDV</div>
              <div className="stat-value">{formatCompact(detailVM.fdv)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">24h 最高</div>
              <div className="stat-value">{formatCompact(detailVM.high24h)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">24h 最低</div>
              <div className="stat-value">{formatCompact(detailVM.low24h)}</div>
            </div>
          </div>
        </section>

        <div className="market-detail-chart ave-token-chart-wrap">
          <div className="detail-chip-row ave-token-time-tabs">
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
              syntheticData={{ currentPrice: detailVM.price, change24h: detailVM.change24h ?? 0 }}
              geckoPool={geckoNetworkId && dexPairAddress ? { network: geckoNetworkId, poolAddress: dexPairAddress } : undefined}
              dexScreener={dexScreenerChainId && dexTokenAddress ? { chainId: dexScreenerChainId, tokenAddress: dexTokenAddress } : undefined}
              period={period}
            />
          </div>

          <div className="market-detail-actions ave-token-cta-row">
            <Link to={quickTradeTargets.buy} className="btn-primary market-detail-action">快捷买入</Link>
            <Link to={quickTradeTargets.sell} className="btn-ghost market-detail-action">快捷卖出</Link>
          </div>
      </div>
    </div>
  )
}
