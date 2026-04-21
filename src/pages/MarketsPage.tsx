import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { type ChainId, type MarketItem, COLLECTION_INTERVAL_MS, fetchDexTokenById, isContractAddress, searchByAddressOrQuery } from '../api/markets'
import { usePageConfig } from '../hooks/usePageConfig'
import { apiUrl } from '../lib/apiBase'
import { formatCurrencyCompact, formatPriceByCurrency, useAppSettings } from '../components/AppSettingsProvider'

const MARKET_SORT_KEY_PREFIX = 'marketSort'
const FOUR_LIST_REFRESH_MS = 15_000

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
  const [fourTab, setFourTab] = useState<'hotInner' | 'newInner' | 'nearFull' | 'newOuter' | 'hotOuter'>('hotInner')
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
    bondingRaisedUsd: number
    marketCapUsd: number
    isOuter: boolean
  }>>({})
  const [fourLoadingMap, setFourLoadingMap] = useState<Record<string, boolean>>({})

  const showPeriodTabs = sourceTab === 'gold' || sourceTab === 'new'

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

  const applyFourDisplayData = (
    item: MarketItem,
    extra: {
      current_price: number
      price_change_percentage_24h: number | null
      market_cap: number
      volume_24h: number
      quoteSymbol: string
      bondingRaisedUsd: number
      marketCapUsd: number
      isOuter: boolean
    },
  ) => {
    const merged: MarketItem = {
      ...item,
      current_price: extra.current_price,
      price_change_percentage_24h: extra.price_change_percentage_24h,
      market_cap: extra.market_cap,
      volume_24h: extra.volume_24h,
    }
    ;(merged as any).quoteSymbol = extra.quoteSymbol
    ;(merged as any).fourBondingRaisedUsd = extra.bondingRaisedUsd
    ;(merged as any).fourMarketCapUsd = extra.marketCapUsd
    ;(merged as any).fourIsOuter = extra.isOuter
    return merged
  }

  const getFourRowMeta = (item: MarketItem) => {
    const progressPct = Number((item as any).fourProgressPct)
    const targetQuoteAmount = Number((item as any).fourTargetQuoteAmount)
    const bondingQuoteAmount = Number((item as any).fourBondingQuoteAmount)
    const remainingSupply = Number((item as any).fourRemainingSupply)
    const latestTradeBlock = Number((item as any).fourLatestTradeBlock)
    const fourCreatedOrder = Number((item as any).fourCreatedOrder)
    const derivedProgressPct =
      targetQuoteAmount > 0 && bondingQuoteAmount >= 0
        ? Math.max(0, Math.min(100, (bondingQuoteAmount / targetQuoteAmount) * 100))
        : null
    const effectiveProgressPct = Number.isFinite(progressPct)
      ? progressPct
      : derivedProgressPct
    const explicitOuter = (item as any).fourIsOuter
    const isOuter =
      typeof explicitOuter === 'boolean'
        ? explicitOuter
        : (
          effectiveProgressPct != null
            ? effectiveProgressPct >= 99.5
            : (Number.isFinite(remainingSupply) ? remainingSupply <= 0 : false)
        )
    const hotScore =
      Math.max(Number(item.volume_24h ?? 0) || 0, 0) * 10 +
      Math.max(Number(item.market_cap ?? 0) || 0, 0) +
      Math.max(Number(item.price_change_percentage_24h ?? 0) || 0, 0) * 1_000 +
      Math.max(Number(item.current_price ?? 0) || 0, 0) * 1_000_000

    return {
      effectiveProgressPct,
      isOuter,
      latestTradeBlock: Number.isFinite(latestTradeBlock) ? latestTradeBlock : 0,
      fourCreatedOrder: Number.isFinite(fourCreatedOrder) ? fourCreatedOrder : 0,
      hotScore,
    }
  }

  const sortFourRows = (items: MarketItem[], tab: 'hotInner' | 'newInner' | 'nearFull' | 'newOuter' | 'hotOuter') => {
    const filtered = items.filter((item) => {
      const meta = getFourRowMeta(item)
      if (tab === 'hotInner' || tab === 'newInner') return !meta.isOuter
      if (tab === 'nearFull') return !meta.isOuter && (meta.effectiveProgressPct ?? 0) >= 80
      if (tab === 'newOuter' || tab === 'hotOuter') return meta.isOuter
      return true
    })

    return [...filtered].sort((a, b) => {
      const am = getFourRowMeta(a)
      const bm = getFourRowMeta(b)
      if (tab === 'newInner' || tab === 'newOuter') {
        return (
          bm.fourCreatedOrder - am.fourCreatedOrder ||
          bm.latestTradeBlock - am.latestTradeBlock ||
          bm.hotScore - am.hotScore
        )
      }
      if (tab === 'nearFull') {
        return (
          (bm.effectiveProgressPct ?? 0) - (am.effectiveProgressPct ?? 0) ||
          bm.hotScore - am.hotScore ||
          bm.latestTradeBlock - am.latestTradeBlock
        )
      }
      return (
        bm.hotScore - am.hotScore ||
        bm.latestTradeBlock - am.latestTradeBlock ||
        (bm.effectiveProgressPct ?? 0) - (am.effectiveProgressPct ?? 0)
      )
    })
  }

  const loadFourSnapshotBatch = async (addresses: string[]) => {
    const out: Record<string, {
      current_price: number
      price_change_percentage_24h: number | null
      market_cap: number
      volume_24h: number
      quoteSymbol: string
      bondingRaisedUsd: number
      marketCapUsd: number
      isOuter: boolean
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
            bondingRaisedUsd?: number | null
            volumeUsd?: number | null
            totalSupply?: number | null
            isOuter?: boolean
          } | null>
        }
        for (const address of chunk) {
          const snapshot = json.snapshots?.[address.toLowerCase()] ?? null
          if (!snapshot) continue
          const isOuter = Boolean(snapshot.isOuter)
          const currentPriceUsd =
            Number(snapshot.currentPriceUsd ?? 0) ||
            (() => {
              const totalSupply = Number(snapshot.totalSupply ?? 0)
              const marketCapUsd = Number(snapshot.marketCapUsd ?? 0)
              return marketCapUsd > 0 && totalSupply > 0 ? marketCapUsd / totalSupply : 0
            })()
          const marketCapUsd = Number(snapshot.marketCapUsd ?? 0) || 0
          const bondingRaisedUsd = Number(snapshot.bondingRaisedUsd ?? snapshot.virtualLiquidityUsd ?? 0) || 0

          if (isOuter) {
            const dexItem = await fetchDexTokenById(`bsc:${address}`)
            if (dexItem && Number(dexItem.current_price ?? 0) > 0) {
              out[address.toLowerCase()] = {
                current_price: Number(dexItem.current_price ?? 0) || 0,
                price_change_percentage_24h: dexItem.price_change_percentage_24h == null ? 0 : Number(dexItem.price_change_percentage_24h),
                market_cap: marketCapUsd > 0 ? marketCapUsd : (Number(dexItem.market_cap ?? 0) || 0),
                volume_24h: Number(dexItem.volume_24h ?? 0) || 0,
                quoteSymbol: 'USDT',
                bondingRaisedUsd,
                marketCapUsd,
                isOuter: true,
              }
              continue
            }
          }

          if (currentPriceUsd <= 0) continue
          out[address.toLowerCase()] = {
            current_price: currentPriceUsd,
            price_change_percentage_24h: snapshot.priceChange24h == null ? 0 : Number(snapshot.priceChange24h),
            market_cap: marketCapUsd,
            volume_24h: Number(snapshot.volumeUsd ?? 0) || 0,
            quoteSymbol: String(snapshot.quoteSymbol ?? 'BNB'),
            bondingRaisedUsd,
            marketCapUsd,
            isOuter,
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
        const json = (await res.json()) as { items?: Array<{ chainId?: string; tokenAddress?: string; dexId?: string; symbol?: string; name?: string; poolName?: string; quoteSymbol?: string; reserveUsd?: string; volumeUsd?: string; priceUsd?: string; priceChange24h?: string; marketCapUsd?: string | null; bondingRaisedUsd?: string | null; isOuter?: boolean; progressPct?: string | null; remainingSupply?: string | null; bondingQuoteAmount?: string | null; targetQuoteAmount?: string | null; latestTradeBlock?: number | null; fourCreatedOrder?: number }> }
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
            market_cap: Number((row as any).marketCapUsd ?? 0) || 0,
            volume_24h: Number((row as any).volumeUsd ?? (row as any).reserveUsd ?? 0) || 0,
            chain,
            dexId: String(row.dexId ?? ''),
            coingeckoId: undefined,
          }
          ;(seed as any).quoteSymbol = quoteSymbol
          ;(seed as any).fourBondingRaisedUsd =
            (row as any).bondingRaisedUsd == null ? 0 : (Number((row as any).bondingRaisedUsd) || 0)
          ;(seed as any).fourMarketCapUsd =
            (row as any).marketCapUsd == null ? 0 : (Number((row as any).marketCapUsd) || 0)
          ;(seed as any).fourIsOuter = Boolean((row as any).isOuter)
          ;(seed as any).fourProgressPct =
            (row as any).progressPct == null ? null : (Number((row as any).progressPct) || 0)
          ;(seed as any).fourRemainingSupply =
            (row as any).remainingSupply == null ? null : (Number((row as any).remainingSupply) || 0)
          ;(seed as any).fourBondingQuoteAmount =
            (row as any).bondingQuoteAmount == null ? null : (Number((row as any).bondingQuoteAmount) || 0)
          ;(seed as any).fourTargetQuoteAmount =
            (row as any).targetQuoteAmount == null ? null : (Number((row as any).targetQuoteAmount) || 0)
          ;(seed as any).fourLatestTradeBlock =
            (row as any).latestTradeBlock == null ? null : (Number((row as any).latestTradeBlock) || 0)
          ;(seed as any).fourCreatedOrder = Number((row as any).fourCreatedOrder ?? 0)
          allSeeds.push(seed)
          if (dex.includes('four')) four.add(key)
          if (dex.includes('four')) fourSeeds.push(seed)
          if (dex.includes('flap')) flap.add(key)
          if (dex.includes('flap')) flapSeeds.push(seed)
        }
        if (cancelled) return
        setNewOpenKeys(all)
        setFourKeys(four)
        setFlapKeys(flap)
        setNewOpenSeedItems(allSeeds)
        setFourSeedItems(fourSeeds)
        setFlapSeedItems(flapSeeds)

        const fourAddresses = fourSeeds
          .map((item) => tokenAddressFromId(item.id).toLowerCase())
          .filter((addr) => /^0x[a-f0-9]{40}$/.test(addr))
        if (fourAddresses.length > 0) {
          void (async () => {
            const fourPatch = await loadFourSnapshotBatch(fourAddresses)
            if (cancelled || Object.keys(fourPatch).length === 0) return
            setFourPriceMap((prev) => ({ ...prev, ...fourPatch }))
            setNewOpenSeedItems((prev) => prev.map((item) => {
              const extra = fourPatch[tokenAddressFromId(item.id).toLowerCase()]
              if (!extra) return item
              return applyFourDisplayData(item, extra)
            }))
            setFourSeedItems((prev) => prev.map((item) => {
              const extra = fourPatch[tokenAddressFromId(item.id).toLowerCase()]
              if (!extra) return item
              return applyFourDisplayData(item, extra)
            }))
          })()
        }
      } catch (e) {
        console.error('加载新开盘来源失败', e)
      }
    }
    void loadNewOpen()
    const t = setInterval(loadNewOpen, FOUR_LIST_REFRESH_MS)
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
    let usingFourCategorySort = false

    if (!useAddressResults) {
      if (sourceTab === 'four' && fourSeedItems.length > 0) {
        next = fourSeedItems.map((item) => {
          const addr = tokenAddressFromId(item.id).toLowerCase()
          const extra = fourPriceMap[addr]
          if (!extra) return item
          return applyFourDisplayData(item, extra)
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

    if (sourceTab === 'four') {
      const liveByKey = new Map(
        list
          .filter((item) => !String(item.dexId ?? '').toLowerCase().includes('four'))
          .map((item) => [marketItemKey(item), item] as const),
      )
      next = next.map((item) => {
        const meta = getFourRowMeta(item)
        if (!meta.isOuter) return item
        const live = liveByKey.get(marketItemKey(item))
        if (!live || Number(live.current_price ?? 0) <= 0) return item
        const merged: MarketItem = {
          ...item,
          current_price: Number(live.current_price ?? 0) || item.current_price,
          price_change_percentage_24h:
            live.price_change_percentage_24h == null ? item.price_change_percentage_24h : live.price_change_percentage_24h,
          market_cap: Number(live.market_cap ?? 0) || (item.market_cap ?? 0),
          volume_24h: Number(live.volume_24h ?? 0) || (item.volume_24h ?? 0),
        }
        ;(merged as any).quoteSymbol = (live as any).quoteSymbol ?? (item as any).quoteSymbol ?? 'USDT'
        return merged
      })
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

    if (sourceTab === 'four') {
      next = sortFourRows(next, fourTab)
      usingFourCategorySort = true
    }

    // 榜单排序：涨幅榜 / 收录榜 / 跌幅榜
    if (usingFourCategorySort) {
      // four.meme 子标签使用自己的排序逻辑
    } else if (rankTab === 'gain') {
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
    fourTab,
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
      .slice(0, 18)

    if (targets.length === 0) return

    let cancelled = false
    const loadFourSnapshots = async () => {
      const pendingTargets = targets.filter((addr) => !fourLoadingMap[addr])
      if (pendingTargets.length === 0) return

      setFourLoadingMap((prev) => {
        const next = { ...prev }
        pendingTargets.forEach((addr) => { next[addr] = true })
        return next
      })

      try {
        const mergedPatch: Record<string, {
          current_price: number
          price_change_percentage_24h: number | null
          market_cap: number
          volume_24h: number
          quoteSymbol: string
          bondingRaisedUsd: number
          marketCapUsd: number
          isOuter: boolean
        }> = {}
        const snapshotMap: Record<string, {
          quoteSymbol?: string
          priceChange24h?: number | null
          marketCapUsd?: number | null
          currentPriceUsd?: number | null
          virtualLiquidityUsd?: number | null
          bondingRaisedUsd?: number | null
          volumeUsd?: number | null
          totalSupply?: number | null
          isOuter?: boolean
        } | null> = {}
        try {
          const res = await fetch(apiUrl(`/api/four-tokens?addresses=${encodeURIComponent(pendingTargets.join(','))}`), { cache: 'no-store' })
          if (res.ok) {
            const json = (await res.json()) as {
              snapshots?: Record<string, {
                quoteSymbol?: string
                priceChange24h?: number | null
                marketCapUsd?: number | null
                currentPriceUsd?: number | null
                virtualLiquidityUsd?: number | null
                bondingRaisedUsd?: number | null
                volumeUsd?: number | null
                totalSupply?: number | null
                isOuter?: boolean
              } | null>
            }
            Object.assign(snapshotMap, json.snapshots ?? {})
          }
        } catch {
          // fall through to per-token fallback below
        }

        for (let i = 0; i < pendingTargets.length; i += 1) {
          const address = pendingTargets[i]
          const snapshot = snapshotMap[address.toLowerCase()] ?? null
          const isOuter = Boolean(snapshot?.isOuter)
          const currentPriceUsd =
            Number(snapshot?.currentPriceUsd ?? 0) ||
            (() => {
              const totalSupply = Number(snapshot?.totalSupply ?? 0)
              const marketCapUsd = Number(snapshot?.marketCapUsd ?? 0)
              return marketCapUsd > 0 && totalSupply > 0 ? marketCapUsd / totalSupply : 0
            })()
          const marketCapUsd = Number(snapshot?.marketCapUsd ?? 0) || 0
          const bondingRaisedUsd = Number(snapshot?.bondingRaisedUsd ?? snapshot?.virtualLiquidityUsd ?? 0) || 0

          if (isOuter) {
            const dexItem = await fetchDexTokenById(`bsc:${address}`)
            if (dexItem && Number(dexItem.current_price ?? 0) > 0) {
              mergedPatch[address.toLowerCase()] = {
                current_price: Number(dexItem.current_price ?? 0) || 0,
                price_change_percentage_24h: dexItem.price_change_percentage_24h == null ? 0 : Number(dexItem.price_change_percentage_24h),
                market_cap: marketCapUsd > 0 ? marketCapUsd : (Number(dexItem.market_cap ?? 0) || 0),
                volume_24h: Number(dexItem.volume_24h ?? 0) || 0,
                quoteSymbol: 'USDT',
                bondingRaisedUsd,
                marketCapUsd,
                isOuter: true,
              }
              continue
            }
          }

          if (snapshot && currentPriceUsd > 0) {
            mergedPatch[address.toLowerCase()] = {
              current_price: currentPriceUsd,
              price_change_percentage_24h: snapshot.priceChange24h == null ? 0 : Number(snapshot.priceChange24h),
              market_cap: marketCapUsd,
              volume_24h: Number(snapshot.volumeUsd ?? 0) || 0,
              quoteSymbol: String(snapshot.quoteSymbol ?? 'BNB'),
              bondingRaisedUsd,
              marketCapUsd,
              isOuter,
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
            quoteSymbol: 'USDT',
            bondingRaisedUsd: 0,
            marketCapUsd: Number(dexItem.market_cap ?? 0) || 0,
            isOuter: true,
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
            pendingTargets.forEach((addr) => { delete next[addr] })
            return next
          })
        }
      }
    }

    void loadFourSnapshots()
    const timer = window.setInterval(() => {
      void loadFourSnapshots()
    }, FOUR_LIST_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [rows, sourceTab, fourLoadingMap])

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
                {sourceTab === 'four' && (
                  <div className="market-period-row">
                    <button type="button" className={fourTab === 'hotInner' ? 'active' : ''} onClick={() => setFourTab('hotInner')}>热内盘</button>
                    <button type="button" className={fourTab === 'newInner' ? 'active' : ''} onClick={() => setFourTab('newInner')}>新内盘</button>
                    <button type="button" className={fourTab === 'nearFull' ? 'active' : ''} onClick={() => setFourTab('nearFull')}>即将打满</button>
                    <button type="button" className={fourTab === 'newOuter' ? 'active' : ''} onClick={() => setFourTab('newOuter')}>新外盘</button>
                    <button type="button" className={fourTab === 'hotOuter' ? 'active' : ''} onClick={() => setFourTab('hotOuter')}>热外盘</button>
                  </div>
                )}
                {showPeriodTabs && (
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
                  const isFourToken = String((item as any).dexId ?? '').toLowerCase().includes('four')
                  const isFourOuter = Boolean((item as any).fourIsOuter)
                  const fourBondingRaisedUsd = Number((item as any).fourBondingRaisedUsd ?? 0) || 0
                  const fourMarketCapUsd = Number((item as any).fourMarketCapUsd ?? item.market_cap ?? 0) || 0
                  const metricLabel = isFourToken ? (isFourOuter ? '市值' : '内盘') : 'Liq'
                  const metricValue = isFourToken
                    ? (isFourOuter ? fourMarketCapUsd : fourBondingRaisedUsd)
                    : ((item.market_cap ?? 0) > 0 ? (item.market_cap ?? 0) : (item.current_price * 125000))
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
                          {metricLabel} {formatCurrencyCompact(metricValue, currencyUnit)}
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
