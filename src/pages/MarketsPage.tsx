import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { type ChainId, type MarketItem, COLLECTION_INTERVAL_MS, isContractAddress, searchByAddressOrQuery } from '../api/markets'

function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

const MARKET_SORT_KEY_PREFIX = 'marketSort'
const MARKET_FAVORITES_KEY_PREFIX = 'marketFavorites'
const MARKET_FAVORITES_ONLY_KEY_PREFIX = 'marketFavoritesOnly'

export function MarketsPage() {
  const { network } = useWallet()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const marketSortKey = `${MARKET_SORT_KEY_PREFIX}:${network}`
  const marketFavoritesKey = `${MARKET_FAVORITES_KEY_PREFIX}:${network}`
  const marketFavoritesOnlyKey = `${MARKET_FAVORITES_ONLY_KEY_PREFIX}:${network}`
  const [list, setList] = useState<MarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'default' | 'change' | 'price'>(() => {
    if (typeof window === 'undefined') return 'default'
    const stored = window.localStorage.getItem(marketSortKey)
    return stored === 'change' || stored === 'price' || stored === 'default' ? stored : 'default'
  })
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    const stored = window.localStorage.getItem(marketFavoritesKey)
    return stored ? JSON.parse(stored) as string[] : []
  })
  const [favoritesOnly, setFavoritesOnly] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(marketFavoritesOnlyKey) === 'true'
  })
  const [chainFilter, setChainFilter] = useState<ChainId | 'all'>('all')
  const [apiProvider, setApiProvider] = useState<string>('')
  const [addressSearchResults, setAddressSearchResults] = useState<MarketItem[] | null>(null)
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)

  const loadMarkets = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const res = await fetch('/api/market?chain=all')
      if (!res.ok) throw new Error('加载行情失败')
      const json = (await res.json()) as { items?: MarketItem[]; provider?: string }
      const data = json.items ?? []
      setList(data)
      setApiProvider(json.provider ?? 'Redis')
      setFavorites((current) => (current.length > 0 ? current : data.slice(0, 3).map((item) => item.id)))
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
    const storedFavorites = window.localStorage.getItem(marketFavoritesKey)
    const storedFavoritesOnly = window.localStorage.getItem(marketFavoritesOnlyKey)
    setSortBy(storedSort === 'change' || storedSort === 'price' || storedSort === 'default' ? storedSort : 'default')
    setFavorites(storedFavorites ? JSON.parse(storedFavorites) as string[] : [])
    setFavoritesOnly(storedFavoritesOnly === 'true')
  }, [marketFavoritesKey, marketFavoritesOnlyKey, marketSortKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(marketSortKey, sortBy)
  }, [marketSortKey, sortBy])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(marketFavoritesKey, JSON.stringify(favorites))
  }, [favorites, marketFavoritesKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(marketFavoritesOnlyKey, String(favoritesOnly))
  }, [favoritesOnly, marketFavoritesOnlyKey])

  const rows = useMemo(() => {
    const useAddressResults = searchQuery && isContractAddress(searchQuery) && addressSearchResults !== null
    let next: MarketItem[] = useAddressResults ? [...addressSearchResults] : [...list].slice(0, 24)

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

    return favoritesOnly ? next.filter((item) => favorites.includes(item.id)) : next
  }, [addressSearchResults, chainFilter, favorites, favoritesOnly, list, searchQuery, sortBy])

  const CHAIN_OPTIONS: { value: ChainId | 'all'; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'eth', label: 'ETH' },
    { value: 'bsc', label: 'BSC' },
    { value: 'sol', label: 'SOL' },
    { value: 'base', label: 'Base' },
  ]
  const toggleFavorite = (id: string) => {
    setFavorites((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  return (
    <div className="page ave-page ave-market-shell">
      <div className="market-panel">
        <div className="market-sort-row">
          <button type="button" className={sortBy === 'default' ? 'active' : ''} onClick={() => setSortBy('default')}>默认</button>
          <button type="button" className={sortBy === 'change' ? 'active' : ''} onClick={() => setSortBy('change')}>涨幅</button>
          <button type="button" className={sortBy === 'price' ? 'active' : ''} onClick={() => setSortBy('price')}>价格</button>
        </div>
        <div className="market-chain-row">
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

        <div className="market-table-head">
          <span>币种 / 池子</span>
          <span>价格</span>
          <span>24h涨跌幅</span>
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

        <div className="market-watch-list">
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
            <div key={item.id} className="market-watch-row-wrap">
              <Link
                to={isDexToken ? `/market/${encodeURIComponent(item.id)}` : `/market/${encodeURIComponent(item.coingeckoId ?? item.id)}`}
                className="market-watch-row"
              >
                {innerLink}
              </Link>
              <button
                type="button"
                className={`market-watch-fav ${favorites.includes(item.id) ? 'active' : ''}`}
                onClick={() => toggleFavorite(item.id)}
                aria-label="收藏"
              >
                {favorites.includes(item.id) ? '★' : '☆'}
              </button>
            </div>
            )
          })}
          {!loading && !addressSearchLoading && rows.length === 0 && (
            <div className="market-empty-note">
              {searchQuery && isContractAddress(searchQuery)
                ? '未找到该合约地址对应的交易对'
                : '暂无匹配的自选池子'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
