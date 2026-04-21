import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { type ChainId, type MarketItem, COLLECTION_INTERVAL_MS, fetchDexTokenById, isContractAddress, searchByAddressOrQuery } from '../api/markets'
import { usePageConfig } from '../hooks/usePageConfig'
import { apiUrl } from '../lib/apiBase'
import { formatCurrencyCompact, formatPriceByCurrency, useAppSettings } from '../components/AppSettingsProvider'

const MARKET_SORT_KEY_PREFIX = 'marketSort'

function tokenFallbackSvgDataUrl(symbol: string) {
  const text = Array.from(String(symbol || '?').trim().replace(/[\uD800-\uDFFF]/g, '') || '?')
    .slice(0, 4)
    .join('')
    .toUpperCase()
  const safe = encodeURIComponent(text)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#1d4ed8'/><stop offset='100%' stop-color='#0f172a'/></linearGradient></defs>` +
    `<rect width='80' height='80' rx='40' fill='url(#g)'/>` +
    `<text x='40' y='46' text-anchor='middle' font-size='22' font-family='Inter,Arial,sans-serif' font-weight='700' fill='#e5e7eb'>${safe}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${svg}`
}

function tokenAddressFromId(id: string): string {
  const i = id.indexOf(':')
  const addr = i >= 0 ? id.slice(i + 1) : id
  return /^0x[a-fA-F0-9]{40}$/.test(addr) ? addr : ''
}

function trustWalletLogoUrl(chain: string | undefined, id: string): string {
  const addr = tokenAddressFromId(id)
  if (!addr) return ''
  const key = String(chain ?? '').toLowerCase()
  const folder =
    key === 'bsc' ? 'smartchain' :
    key === 'eth' ? 'ethereum' :
    key === 'polygon' ? 'polygon' :
    key === 'base' ? 'base' :
    ''
  if (!folder) return ''
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${addr}/logo.png`
}

export function MarketsPage() {
  const { network } = useWallet()
  const { currencyUnit, redUpGreenDown } = useAppSettings()
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
  const [addressSearchResults, setAddressSearchResults] = useState<MarketItem[] | null>(null)
  const [addressSearchLoading, setAddressSearchLoading] = useState(false)
  const SUPPORTED_MARKET_CHAINS: ChainId[] = ['eth', 'bsc', 'base']
  const [sourceTab, setSourceTab] = useState<'gold' | 'new' | 'four' | 'flap'>('gold')
  const [rankTab, setRankTab] = useState<'gain' | 'included' | 'loss'>('included')
  const [period, setPeriod] = useState<'5m' | '1h' | '4h' | '24h'>('24h')
  const [newOpenKeys, setNewOpenKeys] = useState<Set<string>>(new Set())
  const [fourKeys, setFourKeys] = useState<Set<string>>(new Set())
  const [flapKeys, setFlapKeys] = useState<Set<string>>(new Set())
  const [newOpenSeedItems, setNewOpenSeedItems] = useState<MarketItem[]>([])
  const [fourSeedItems, setFourSeedItems] = useState<MarketItem[]>([])
  const [flapSeedItems, setFlapSeedItems] = useState<MarketItem[]>([])
  const [fourPriceMap, setFourPriceMap] = useState<Record<string, {
    current_price: number
    price_change_percentage_24h: number | null
    market_cap: number
    volume_24h: number
    quoteSymbol: string
  }>>({})
  const [fourLoadingMap, setFourLoadingMap] = useState<Record<string, boolean>>({})

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

  const mergeRowsByKey = (base: MarketItem[], seeds: MarketItem[]) => {
    const byKey = new Map<string, MarketItem>()
    for (const it of base) {
      byKey.set(marketItemKey(it), it)
    }
    for (const it of seeds) {
      const k = marketItemKey(it)
      if (!byKey.has(k)) byKey.set(k, it)
    }
    return [...byKey.values()]
  }

  const loadFourSnapshotBatch = async (addresses: string[]) => {
    const out: Record<string, {
      current_price: number
      price_change_percentage_24h: number | null
      market_cap: number
      volume_24h: number
      quoteSymbol: string
    }> = {}
    const chunkSize = 12
    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, i + chunkSize)
      if (chunk.length === 0) continue
      try {
        const res = await fetch(apiUrl(`/api/four-tokens?addresses=${encodeURIComponent(chunk.join(','))}`), { cache: 'no-store' })
        if (!res.ok) continue
        const json = (await res.json()) as {
          snapshots?: Record<string, {
            quoteSymbol?: string
            priceChange24h?: number | null
            marketCapUsd?: number | null
            currentPriceUsd?: number | null
            virtualLiquidityUsd?: number | null
            volumeUsd?: number | null
            totalSupply?: number | null
          } | null>
        }
        for (const address of chunk) {
          const snapshot = json.snapshots?.[address.toLowerCase()] ?? null
          if (!snapshot) continue
          const currentPriceUsd =
            Number(snapshot.currentPriceUsd ?? 0) ||
            (() => {
              const totalSupply = Number(snapshot.totalSupply ?? 0)
              const marketCapUsd = Number(snapshot.marketCapUsd ?? 0)
              return marketCapUsd > 0 && totalSupply > 0 ? marketCapUsd / totalSupply : 0
            })()
          if (currentPriceUsd <= 0) continue
          out[address.toLowerCase()] = {
            current_price: currentPriceUsd,
            price_change_percentage_24h: snapshot.priceChange24h == null ? 0 : Number(snapshot.priceChange24h),
            market_cap: Number(snapshot.virtualLiquidityUsd ?? snapshot.marketCapUsd ?? 0) || 0,
            volume_24h: Number(snapshot.volumeUsd ?? 0) || 0,
            quoteSymbol: String(snapshot.quoteSymbol ?? 'BNB'),
          }
        }
      } catch {
        // ignore batch failure and keep fallback path
      }
    }
    return out
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
        const json = (await res.json()) as { items?: Array<{ chainId?: string; tokenAddress?: string; dexId?: string; symbol?: string; name?: string; poolName?: string; quoteSymbol?: string; reserveUsd?: string; volumeUsd?: string; priceUsd?: string; priceChange24h?: string }> }
        const all = new Set<string>()
        const four = new Set<string>()
        const flap = new Set<string>()
        const allSeeds: MarketItem[] = []
        const fourSeeds: MarketItem[] = []
        const flapSeeds: MarketItem[] = []
        for (const row of json.items ?? []) {
          const chain = normalizeNewTokenChain(String(row.chainId ?? ''))
          const addr = String(row.tokenAddress ?? '').toLowerCase()
          if (!chain || !addr.startsWith('0x') || addr.length !== 42) continue
          const key = `${chain}:${addr}`
          all.add(key)
          const dex = String(row.dexId ?? '').toLowerCase()
          const symbol = String((row as any).symbol ?? '').trim() || 'NEW'
          const name = String((row as any).name ?? (row as any).poolName ?? symbol).trim() || symbol
          const quoteSymbol = String((row as any).quoteSymbol ?? 'BNB').trim() || 'BNB'
          const seed: MarketItem = {
            id: key,
            symbol,
            name,
            image: '',
            current_price: Number((row as any).priceUsd ?? 0) || 0,
            price_change_percentage_24h:
              (row as any).priceChange24h == null ? null : (Number((row as any).priceChange24h) || 0),
            market_cap: Number((row as any).reserveUsd ?? 0) || 0,
            volume_24h: Number((row as any).volumeUsd ?? (row as any).reserveUsd ?? 0) || 0,
            chain,
            dexId: String(row.dexId ?? ''),
            coingeckoId: undefined,
          }
          ;(seed as any).quoteSymbol = quoteSymbol
          allSeeds.push(seed)
          if (dex.includes('four')) four.add(key)
          if (dex.includes('four')) fourSeeds.push(seed)
          if (dex.includes('flap')) flap.add(key)
          if (dex.includes('flap')) flapSeeds.push(seed)
        }
        const fourAddresses = fourSeeds
          .map((item) => tokenAddressFromId(item.id).toLowerCase())
          .filter((addr) => /^0x[a-f0-9]{40}$/.test(addr))
        const fourPatch = fourAddresses.length > 0 ? await loadFourSnapshotBatch(fourAddresses) : {}
        if (Object.keys(fourPatch).length > 0) {
          const mergeSeed = (item: MarketItem) => {
            const extra = fourPatch[tokenAddressFromId(item.id).toLowerCase()]
            if (!extra) return item
            const merged: MarketItem = {
              ...item,
              current_price: extra.current_price,
              price_change_percentage_24h: extra.price_change_percentage_24h,
              market_cap: extra.market_cap,
              volume_24h: extra.volume_24h,
            }
            ;(merged as any).quoteSymbol = extra.quoteSymbol
            return merged
          }
          for (let i = 0; i < allSeeds.length; i += 1) {
            allSeeds[i] = mergeSeed(allSeeds[i])
          }
          for (let i = 0; i < fourSeeds.length; i += 1) {
            fourSeeds[i] = mergeSeed(fourSeeds[i])
          }
          if (!cancelled) {
            setFourPriceMap((prev) => ({ ...prev, ...fourPatch }))
          }
        }
        if (cancelled) return
        setNewOpenKeys(all)
        setFourKeys(four)
        setFlapKeys(flap)
        setNewOpenSeedItems(allSeeds)
        setFourSeedItems(fourSeeds)
        setFlapSeedItems(flapSeeds)
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
    let usingSourceSeedOnly = false

    if (!useAddressResults) {
      if (sourceTab === 'four' && fourSeedItems.length > 0) {
        next = fourSeedItems.map((item) => {
          const addr = tokenAddressFromId(item.id).toLowerCase()
          const extra = fourPriceMap[addr]
          if (!extra) return item
          const merged: MarketItem = {
            ...item,
            current_price: extra.current_price,
            price_change_percentage_24h: extra.price_change_percentage_24h,
            market_cap: extra.market_cap,
            volume_24h: extra.volume_24h,
          }
          ;(merged as any).quoteSymbol = extra.quoteSymbol
          return merged
        })
        usingSourceSeedOnly = true
      } else if (sourceTab === 'new' && newOpenSeedItems.length > 0) {
        next = [...newOpenSeedItems]
        usingSourceSeedOnly = true
      } else if (sourceTab === 'flap' && flapSeedItems.length > 0) {
        next = [...flapSeedItems]
        usingSourceSeedOnly = true
      }
    }

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
    } else if (sourceTab === 'new' && !usingSourceSeedOnly) {
      next = mergeRowsByKey(
        next.filter((item) => newOpenKeys.has(marketItemKey(item))),
        newOpenSeedItems,
      )
    } else if (sourceTab === 'four' && !usingSourceSeedOnly) {
      next = mergeRowsByKey(
        next.filter((item) => fourKeys.has(marketItemKey(item))),
        fourSeedItems,
      )
    } else if (sourceTab === 'flap' && !usingSourceSeedOnly) {
      next = mergeRowsByKey(
        next.filter((item) => flapKeys.has(marketItemKey(item))),
        flapSeedItems,
      )
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
  }, [
    addressSearchResults,
    chainFilter,
    list,
    searchQuery,
    sortBy,
    sourceTab,
    rankTab,
    newOpenKeys,
    fourKeys,
    flapKeys,
    newOpenSeedItems,
    fourSeedItems,
    flapSeedItems,
    fourPriceMap,
  ])

  useEffect(() => {
    if (sourceTab !== 'four') return
    const targets = rows
      .map((item) => tokenAddressFromId(item.id).toLowerCase())
      .filter((addr) => /^0x[a-f0-9]{40}$/.test(addr))
      .filter((addr) => !fourPriceMap[addr] && !fourLoadingMap[addr])
      .slice(0, 18)

    if (targets.length === 0) return
    
    // 标记这些地址为正在加载
    setFourLoadingMap(prev => {
      const next = { ...prev }
      targets.forEach(addr => { next[addr] = true })
      return next
    })

    let cancelled = false
    const loadFourSnapshots = async () => {
      try {
        const mergedPatch: Record<string, {
          current_price: number
          price_change_percentage_24h: number | null
          market_cap: number
          volume_24h: number
          quoteSymbol: string
        }> = {}
        const snapshotMap: Record<string, {
          quoteSymbol?: string
          priceChange24h?: number | null
          marketCapUsd?: number | null
          currentPriceUsd?: number | null
          virtualLiquidityUsd?: number | null
          volumeUsd?: number | null
          totalSupply?: number | null
        } | null> = {}
        try {
          const res = await fetch(apiUrl(`/api/four-tokens?addresses=${encodeURIComponent(targets.join(','))}`), { cache: 'no-store' })
          if (res.ok) {
            const json = (await res.json()) as {
              snapshots?: Record<string, {
                quoteSymbol?: string
                priceChange24h?: number | null
                marketCapUsd?: number | null
                currentPriceUsd?: number | null
                virtualLiquidityUsd?: number | null
                volumeUsd?: number | null
                totalSupply?: number | null
              } | null>
            }
            Object.assign(snapshotMap, json.snapshots ?? {})
          }
        } catch {
          // fall through to per-token fallback below
        }

        for (let i = 0; i < targets.length; i += 1) {
          const address = targets[i]
          const snapshot = snapshotMap[address.toLowerCase()] ?? null
          const currentPriceUsd =
            Number(snapshot?.currentPriceUsd ?? 0) ||
            (() => {
              const totalSupply = Number(snapshot?.totalSupply ?? 0)
              const marketCapUsd = Number(snapshot?.marketCapUsd ?? 0)
              return marketCapUsd > 0 && totalSupply > 0 ? marketCapUsd / totalSupply : 0
            })()

          if (snapshot && currentPriceUsd > 0) {
            mergedPatch[address.toLowerCase()] = {
              current_price: currentPriceUsd,
              price_change_percentage_24h: snapshot.priceChange24h == null ? 0 : Number(snapshot.priceChange24h),
              market_cap: Number(snapshot.virtualLiquidityUsd ?? snapshot.marketCapUsd ?? 0) || 0,
              volume_24h: Number(snapshot.volumeUsd ?? 0) || 0,
              quoteSymbol: String(snapshot.quoteSymbol ?? 'BNB'),
            }
            continue
          }

          const dexItem = await fetchDexTokenById(`bsc:${address}`)
          if (!dexItem) continue
          mergedPatch[address.toLowerCase()] = {
            current_price: Number(dexItem.current_price ?? 0) || 0,
            price_change_percentage_24h: dexItem.price_change_percentage_24h == null ? 0 : Number(dexItem.price_change_percentage_24h),
            market_cap: Number(dexItem.market_cap ?? 0) || 0,
            volume_24h: Number(dexItem.volume_24h ?? 0) || 0,
            quoteSymbol: 'BNB',
          }
        }
        if (!cancelled && Object.keys(mergedPatch).length > 0) {
          setFourPriceMap((prev) => ({ ...prev, ...mergedPatch }))
        }
      } catch (e) {
        console.error('加载 four 列表补值失败', e)
      } finally {
        if (!cancelled) {
          setFourLoadingMap((prev) => {
            const next = { ...prev }
            targets.forEach((addr) => { delete next[addr] })
            return next
          })
        }
      }
    }

    void loadFourSnapshots()
    return () => { cancelled = true }
  }, [rows, sourceTab, fourPriceMap, fourLoadingMap])

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
                        <img
                          src={item.image?.trim() ? item.image : tokenFallbackSvgDataUrl(item.symbol)}
                          alt=""
                          className="market-watch-icon"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const t = e.currentTarget
                            const stage = Number(t.dataset.fallbackStage ?? '0')
                            if (stage === 0) {
                              const tw = trustWalletLogoUrl(item.chain, item.id)
                              if (tw) {
                                t.dataset.fallbackStage = '1'
                                t.src = tw
                                return
                              }
                            }
                            if (stage <= 1) {
                              t.dataset.fallbackStage = '2'
                              t.src = tokenFallbackSvgDataUrl(item.symbol)
                            }
                          }}
                        />
                        <div>
                          <div className="market-watch-name">{item.symbol?.toUpperCase() ?? item.symbol}</div>
                          <div className="market-watch-sub">
                            <span>{item.symbol.toUpperCase()}/{String((item as any).quoteSymbol ?? 'USDC').toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="market-watch-price">
                        {formatPriceByCurrency(item.current_price, currencyUnit)}
                        <div className="market-watch-price-sub">
                          Liq {formatCurrencyCompact((item.market_cap ?? 0) > 0 ? (item.market_cap ?? 0) : (item.current_price * 125000), currencyUnit)}
                        </div>
                      </div>
                      <div
                        className={`market-watch-change ${
                          (item.price_change_percentage_24h ?? 0) >= 0
                            ? (redUpGreenDown ? 'down' : 'up')
                            : (redUpGreenDown ? 'up' : 'down')
                        }`}
                      >
                        {item.price_change_percentage_24h != null ? (
                          <>
                            {(item.price_change_percentage_24h ?? 0) >= 0 ? '+' : ''}
                            {(item.price_change_percentage_24h ?? 0).toFixed(2)}%
                          </>
                        ) : '—'}
                      </div>
                    </>
                  )
                  const extraQuery = (item as any).dexId ? `?src=${encodeURIComponent(String((item as any).dexId))}` : ''
                  return (
                    <Link
                      key={item.id}
                      to={isDexToken ? `/market/${encodeURIComponent(item.id)}${extraQuery}` : `/market/${encodeURIComponent(item.coingeckoId ?? item.id)}`}
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
