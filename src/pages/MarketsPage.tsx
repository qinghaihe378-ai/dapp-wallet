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
  const chainFromQuery = (searchParams.get('chain') ?? '').toLowerCase()
  const chainFilter: ChainId | 'all' =
    chainFromQuery === 'eth' || chainFromQuery === 'bsc' || chainFromQuery === 'base'
      ? (chainFromQuery as ChainId)
      : 'all'
  const [apiProvider, setApiProvider] = useState<string>('')
  const [addressSearchResults, setAddressSearchResults] = useState<MarketItem[] | null>(null)
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)
  const SUPPORTED_MARKET_CHAINS: ChainId[] = ['eth', 'bsc', 'base']
  const [sourceTab, setSourceTab] = useState<'gold' | 'new' | 'four' | 'flap'>('gold')
  const [rankTab, setRankTab] = useState<'gain' | 'included' | 'loss'>('included')
  const [period, setPeriod] = useState<'5m' | '1h' | '4h' | '24h'>('24h')
  const [newOpenKeys, setNewOpenKeys] = useState<Set<string>>(new Set())
  const [fourKeys, setFourKeys] = useState<Set<string>>(new Set())
  const [flapKeys, setFlapKeys] = useState<Set<string>>(new Set())

  const normalizeNewTokenChain = (raw: string): ChainId | null => {
    const c = String(raw).toLowerCase()
    if (c === 'eth' || c === 'ethereum' || c === 'mainnet') return 'eth'
    if (c === 'bsc') return 'bsc'
    if (c === 'base') return 'base'
    return null
  }

  const marketItemKey = (item: MarketItem) => {
    const i = item.id.indexOf(':')
    if (i < 0) return ''
    const addr = item.id.slice(i + 1).toLowerCase()
    return addr.startsWith('0x') ? `${item.chain}:${addr}` : ''
  }

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
    let cancelled = false
    const loadNewOpen = async () => {
      try {
        const res = await fetch(apiUrl('/api/new-tokens'), { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as { items?: Array<{ chainId?: string; tokenAddress?: string; dexId?: string }> }
        const all = new Set<string>()
        const four = new Set<string>()
        const flap = new Set<string>()
        for (const row of json.items ?? []) {
          const chain = normalizeNewTokenChain(String(row.chainId ?? ''))
          const addr = String(row.tokenAddress ?? '').toLowerCase()
          if (!chain || !addr.startsWith('0x') || addr.length !== 42) continue
          const key = `${chain}:${addr}`
          all.add(key)
          const dex = String(row.dexId ?? '').toLowerCase()
          if (dex.includes('four')) four.add(key)
          if (dex.includes('flap')) flap.add(key)
        }
        if (cancelled) return
        setNewOpenKeys(all)
        setFourKeys(four)
        setFlapKeys(flap)
      } catch (e) {
        console.error('加载新开盘来源失败', e)
      }
    }
    void loadNewOpen()
    const t = setInterval(loadNewOpen, 30_000)
    return () => { cancelled = true; clearInterval(t) }
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

    // 行情页默认仅展示 ETH/BSC/Base 三条公链
    next = next.filter((item) => SUPPORTED_MARKET_CHAINS.includes(item.chain))

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

    // 来源标签：按真实来源过滤
    if (sourceTab === 'gold') {
      // 淘金默认不过滤，走榜单排序
    } else if (sourceTab === 'new') {
      next = next.filter((item) => newOpenKeys.has(marketItemKey(item)))
    } else if (sourceTab === 'four') {
      next = next.filter((item) => fourKeys.has(marketItemKey(item)))
    } else if (sourceTab === 'flap') {
      next = next.filter((item) => flapKeys.has(marketItemKey(item)))
    }

    // 榜单排序：涨幅榜 / 收录榜 / 跌幅榜
    if (rankTab === 'gain') {
      next = [...next].sort((a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity))
    } else if (rankTab === 'loss') {
      next = [...next].sort((a, b) => (a.price_change_percentage_24h ?? Infinity) - (b.price_change_percentage_24h ?? Infinity))
    } else if (sortBy === 'price') {
      next = [...next].sort((a, b) => b.current_price - a.current_price)
    } else if (sortBy === 'change') {
      next = [...next].sort((a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity))
    } else {
      // 收录榜
      next = [...next].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
    }

    return useAddressResults ? next : next.slice(0, 120)
  }, [addressSearchResults, chainFilter, list, searchQuery, sortBy, sourceTab, rankTab, newOpenKeys, fourKeys, flapKeys])

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
                  <button type="button" className={sourceTab === 'gold' ? 'active' : ''} onClick={() => setSourceTab('gold')}>淘金</button>
                  <button type="button" className={sourceTab === 'new' ? 'active' : ''} onClick={() => setSourceTab('new')}>新开盘</button>
                  <button type="button" className={sourceTab === 'four' ? 'active' : ''} onClick={() => setSourceTab('four')}>Four.meme</button>
                  <button type="button" className={sourceTab === 'flap' ? 'active' : ''} onClick={() => setSourceTab('flap')}>Flap</button>
                  <span className="market-source-split" />
                  <button type="button" className={rankTab === 'gain' ? 'active' : ''} onClick={() => setRankTab('gain')}>涨幅榜</button>
                  <button type="button" className={rankTab === 'included' ? 'active' : ''} onClick={() => setRankTab('included')}>收录榜</button>
                  <button type="button" className={rankTab === 'loss' ? 'active' : ''} onClick={() => setRankTab('loss')}>跌幅榜</button>
                </div>
                <div className="market-period-row">
                  <button type="button" className={period === '5m' ? 'active' : ''} onClick={() => { setPeriod('5m'); setSortBy('default') }}>5m</button>
                  <button type="button" className={period === '1h' ? 'active' : ''} onClick={() => { setPeriod('1h'); setSortBy('price') }}>1h</button>
                  <button type="button" className={period === '4h' ? 'active' : ''} onClick={() => { setPeriod('4h'); setSortBy('change') }}>4h</button>
                  <button type="button" className={period === '24h' ? 'active' : ''} onClick={() => { setPeriod('24h'); setSortBy('change') }}>24h</button>
                  <span className="market-period-tools">
                    <button type="button" aria-label="排序">☰</button>
                    <button type="button" aria-label="筛选">⌯</button>
                  </span>
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
                  <span>成交额 / 持币人</span>
                  <span>价格</span>
                  <span>涨幅</span>
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
