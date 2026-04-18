import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { type ChainId, type MarketItem, COLLECTION_INTERVAL_MS, isContractAddress, searchByAddressOrQuery } from '../api/markets'
import { usePageConfig } from '../hooks/usePageConfig'
import { apiUrl } from '../lib/apiBase'

function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

const MARKET_SORT_KEY_PREFIX = 'marketSort'

export function MarketsPage() {
  const { network } = useWallet()
  const { config } = usePageConfig('market')
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const marketSortKey = `${MARKET_SORT_KEY_PREFIX}:${network}`
  const [list, setList] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'default' | 'change' | 'price'>(() => {
    if (typeof window === 'undefined') return 'default'
    const stored = window.localStorage.getItem(marketSortKey)
    return stored === 'change' || stored === 'price' || stored === 'default' ? stored : 'default'
  })
  const [chainFilter, setChainFilter] = useState<ChainId | 'all'>('all')
  const [apiProvider, setApiProvider] = useState<string>('')
  const [addressSearchResults, setAddressSearchResults] = useState<MarketItem[] | null>(null)
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)

  const loadMarkets = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const res = await fetch(apiUrl('/api/market?chain=all'), { cache: 'no-store' })
      if (!res.ok) throw new Error('加载行情失败')
      const json = (await res.json()) as { items?: MarketItem[]; provider?: string }
      const data = json.items ?? []
      setList(data)
      setApiProvider(json.provider ?? 'Redis')
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : '加载行情失败，请稍后重试。')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void loadMarkets()
    const t = setInterval(() => void loadMarkets(true), COLLECTION_INTERVAL_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!searchQuery || !isContractAddress(searchQuery)) {
      setAddressSearchResults(null)
      return
    }
    let cancelled = false
    setAddressSearchLoading(true)
    setAddressSearchResults(null)
    searchByAddressOrQuery(searchQuery)
      .then((data) => {
        if (!cancelled) setAddressSearchResults(data)
      })
      .catch((e) => {
        if (!cancelled) {
          console.error('合约地址搜索失败', e)
          setAddressSearchResults([])
        }
      })
      .finally(() => {
        if (!cancelled) setAddressSearchLoading(false)
      })
    return () => { cancelled = true }
  }, [searchQuery])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedSort = window.localStorage.getItem(marketSortKey)
    setSortBy(storedSort === 'change' || storedSort === 'price' || storedSort === 'default' ? storedSort : 'default')
  }, [marketSortKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(marketSortKey, sortBy)
  }, [marketSortKey, sortBy])

  const rows = useMemo(() => {
    const useAddressResults = searchQuery && isContractAddress(searchQuery) && addressSearchResults !== null
    let next: MarketItem[] = useAddressResults ? [...addressSearchResults] : [...list]

    if (chainFilter !== 'all') {
      next = next.filter((item) => item.chain === chainFilter)
    }

    if (searchQuery && !useAddressResults) {
      const q = searchQuery.toLowerCase()
      next = next.filter(
        (item) =>
          item.symbol.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q)
      )
    }

    if (sortBy === 'change') {
      next = [...next].sort((a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity))
    } else if (sortBy === 'price') {
      next = [...next].sort((a, b) => b.current_price - a.current_price)
    }

    return useAddressResults ? next : next.slice(0, 120)
  }, [addressSearchResults, chainFilter, list, searchQuery, sortBy])

  const CHAIN_OPTIONS: { value: ChainId | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'eth', label: 'ETH' },
    { value: 'bsc', label: 'BSC' },
    { value: 'base', label: 'Base' },
    { value: 'polygon', label: 'Polygon' },
  ]
  const sections = useMemo(() => {
    const defaults = [
      { id: 'controls', enabled: true, order: 0 },
      { id: 'table', enabled: true, order: 1 },
      { id: 'list', enabled: true, order: 2 },
    ]
    const fromCfg = config?.sections && Array.isArray(config.sections) ? config.sections : defaults
    return [...fromCfg]
      .filter((s) => s && typeof s.id === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((s) => s.enabled !== false)
  }, [config?.sections])

  return (
    <div className="page ave-page ave-market-shell ave-markets-v2">
      <div className="market-panel ave-markets-v2-panel">
        {config?.notice && <div className="market-api-hint">{config.notice}</div>}

        {sections.map((s) => {
          if (s.id === 'controls') {
            return (
              <div key="controls" className="ave-markets-v2-controls">
                <div className="market-sort-row ave-markets-v2-sort-row">
                  <button type="button" className={sortBy === 'default' ? 'active' : ''} onClick={() => setSortBy('default')}>默认</button>
                  <button type="button" className={sortBy === 'change' ? 'active' : ''} onClick={() => setSortBy('change')}>涨幅</button>
                  <button type="button" className={sortBy === 'price' ? 'active' : ''} onClick={() => setSortBy('price')}>价格</button>
                </div>
                <div className="market-chain-row ave-markets-v2-chain-row">
                  {CHAIN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`market-chain-pill ${chainFilter === opt.value ? 'active' : ''}`}
                      onClick={() => setChainFilter(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {apiProvider && (
                  <div className="market-api-hint">数据源: {apiProvider}</div>
                )}
              </div>
            )
          }

          if (s.id === 'table') {
            return (
              <div key="table" className="ave-markets-v2-table-wrap">
                <div className="market-table-head ave-markets-v2-table-head">
                  <span>代币</span>
                  <span>价格</span>
                  <span>24h</span>
                </div>

                {(loading || addressSearchLoading) && <p className="ave-loading">加载中…</p>}
                {error && (
                  <div className="market-error-wrap">
                    <p className="error">{error}</p>
                    <button type="button" className="btn-primary market-retry-btn" onClick={() => void loadMarkets()}>
                      重新加载
                    </button>
                  </div>
                )}
              </div>
            )
          }

          if (s.id === 'list') {
            return (
              <div key="list" className="market-watch-list ave-markets-v2-list">
                {rows.map((item) => {
                  const isDexToken = item.id.includes(':')
                  const innerLink = (
                    <>
                      <div className="market-watch-main">
                        <img src={item.image} alt="" className="market-watch-icon" />
                        <div>
                          <div className="market-watch-name">{item.symbol?.toUpperCase() ?? item.symbol}</div>
                          <div className="market-watch-sub">
                            <span>{item.symbol.toUpperCase()}/USDC</span>
                            <span className={`market-watch-chain market-watch-chain-${item.chain}`}>
                              {item.chain.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="market-watch-price">
                        ${item.current_price < 1 ? item.current_price.toFixed(6) : item.current_price.toFixed(4)}
                        <div className="market-watch-price-sub">Vol {formatCompact(item.current_price * 125000)}</div>
                      </div>
                      <div className={`market-watch-change ${(item.price_change_percentage_24h ?? 0) >= 0 ? 'up' : 'down'}`}>
                        {(item.price_change_percentage_24h ?? 0) >= 0 ? '+' : ''}
                        {(item.price_change_percentage_24h ?? 0).toFixed(2)}%
                      </div>
                    </>
                  )
                  return (
                    <Link
                      key={item.id}
                      to={isDexToken ? `/market/${encodeURIComponent(item.id)}` : `/market/${encodeURIComponent(item.coingeckoId ?? item.id)}`}
                      className="market-watch-row"
                    >
                      {innerLink}
                    </Link>
                  )
                })}
                {!loading && !addressSearchLoading && rows.length === 0 && (
                  <div className="market-empty-note">
                    {searchQuery && isContractAddress(searchQuery)
                      ? '未找到该合约地址对应的交易对'
                      : '暂无匹配的交易池子'}
                  </div>
                )}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
