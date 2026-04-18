import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { COLLECTION_INTERVAL_MS } from '../api/markets'
import { apiUrl } from '../lib/apiBase'
import { usePageConfig } from '../hooks/usePageConfig'
import { useSystemConfig } from '../hooks/useSystemConfig'

interface HomeItem {
  id: string
  symbol: string
  name: string
  image: string
  current_price: number
  price_change_percentage_24h: number | null
  market_cap: number
  chain?: string
}

type HomeSection = 'hot' | 'gain' | 'loss' | 'alpha'
type TopTickerItem = { label: '龙虾' | 'BTCB' | 'ETH' | 'WBNB'; price: number | null; change: number | null }

const HOME_QUICK_ACTION_KEY_PREFIX = 'homeQuickAction'
const HOME_FILTER_KEY_PREFIX = 'homeActiveFilter'
const HOME_SECTION_KEY_PREFIX = 'homeActiveSection'
const HOME_MAX_VISIBLE_TOKENS = 60
const TOP_TICKER_REFRESH_MS = 8_000

function hasTokenAvatar(image: string | undefined | null): boolean {
  if (image == null || typeof image !== 'string') return false
  return image.trim().length > 0
}

function tokenFallbackSvgDataUrl(symbol: string) {
  const text = (symbol || '?').trim().slice(0, 4).toUpperCase()
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

export function HomePage() {
  const { network } = useWallet()
  const { config } = usePageConfig('home')
  const { config: systemConfig } = useSystemConfig()
  const homeQuickActionKey = `${HOME_QUICK_ACTION_KEY_PREFIX}:${network}`
  const homeFilterKey = `${HOME_FILTER_KEY_PREFIX}:${network}`
  const homeSectionKey = `${HOME_SECTION_KEY_PREFIX}:${network}`
  const [items, setItems] = useState<HomeItem[]>([])
  const [topTicker, setTopTicker] = useState<TopTickerItem[]>([
    { label: '龙虾', price: null, change: null },
    { label: 'BTCB', price: null, change: null },
    { label: 'ETH', price: null, change: null },
    { label: 'WBNB', price: null, change: null },
  ])
  const [activeSection, setActiveSection] = useState<HomeSection>(() => {
    if (typeof window === 'undefined') return 'hot'
    const stored = window.localStorage.getItem(homeSectionKey)
    return stored === 'gain' || stored === 'loss' || stored === 'alpha' ? stored : 'hot'
  })
  const [activeQuickAction, setActiveQuickAction] = useState<'receive' | 'invite' | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(homeQuickActionKey)
    return stored === 'receive' || stored === 'invite' ? stored : null
  })
  const [activeFilter, setActiveFilter] = useState<'all' | 'eth' | 'bsc' | 'base' | 'sol'>(() => {
    if (typeof window === 'undefined') return 'all'
    const stored = window.localStorage.getItem(homeFilterKey)
    return stored === 'eth' || stored === 'bsc' || stored === 'base' || stored === 'sol' || stored === 'all' ? stored : 'all'
  })
  const [homeSearch] = useState('')
  const baseFiltered =
    activeFilter === 'all'
      ? items
      : items.filter((item) => {
          const chain = item.chain?.toLowerCase()
          if (activeFilter === 'eth') return chain === 'eth' || chain === 'btc'
          if (activeFilter === 'bsc') return chain === 'bsc'
          if (activeFilter === 'base') return chain === 'base'
          if (activeFilter === 'sol') return chain === 'sol' || chain === 'solana'
          return true
        })
  const filteredItems = useMemo(() => {
    let next = [...baseFiltered]
    if (homeSearch.trim()) {
      const q = homeSearch.trim().toLowerCase()
      next = next.filter((item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
    }
    if (activeSection === 'gain') {
      return next
        .sort(
        (a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity)
      )
        .slice(0, HOME_MAX_VISIBLE_TOKENS)
    }
    if (activeSection === 'loss') {
      return next
        .sort(
        (a, b) => (a.price_change_percentage_24h ?? Infinity) - (b.price_change_percentage_24h ?? Infinity)
      )
        .slice(0, HOME_MAX_VISIBLE_TOKENS)
    }
    if (activeSection === 'alpha') {
      return next
        .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
        .slice(0, HOME_MAX_VISIBLE_TOKENS)
    }
    // 热门：仅展示有头像（非空 image）的代币
    return next.filter((item) => hasTokenAvatar(item.image)).slice(0, HOME_MAX_VISIBLE_TOKENS)
  }, [activeSection, baseFiltered, homeSearch])

  useEffect(() => {
    const load = async () => {
      try {
        const marketUrl = activeSection === 'alpha' ? '/api/market?chain=all&scope=alpha' : '/api/market?chain=all'
        const res = await fetch(apiUrl(marketUrl), { cache: 'no-store' })
        if (!res.ok) throw new Error('加载行情失败')
        const json = (await res.json()) as { items?: HomeItem[] }
        const data = json.items ?? []
        setItems(data.map((item) => ({ ...item, market_cap: (item as any).market_cap ?? 0 })))
      } catch (e) {
        console.error(e)
      }
    }

    void load()
    const t = setInterval(load, COLLECTION_INTERVAL_MS)
    return () => clearInterval(t)
  }, [activeSection])

  useEffect(() => {
    const loadTicker = async () => {
      try {
        const res = await fetch(apiUrl('/api/top-ticker'), { cache: 'no-store' })
        if (!res.ok) throw new Error('加载顶部行情失败')
        const json = (await res.json()) as { items?: TopTickerItem[] }
        const list = Array.isArray(json.items) ? json.items : []
        if (list.length > 0) setTopTicker(list)
      } catch (e) {
        console.error(e)
      }
    }

    void loadTicker()
    const t = setInterval(loadTicker, TOP_TICKER_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedQuickAction = window.localStorage.getItem(homeQuickActionKey)
    const storedFilter = window.localStorage.getItem(homeFilterKey)
    const storedSection = window.localStorage.getItem(homeSectionKey)
    queueMicrotask(() => {
      setActiveQuickAction(storedQuickAction === 'receive' || storedQuickAction === 'invite' ? storedQuickAction : null)
      setActiveFilter(
        storedFilter === 'eth' || storedFilter === 'bsc' || storedFilter === 'base' || storedFilter === 'sol' || storedFilter === 'all'
          ? storedFilter
          : 'all',
      )
      setActiveSection(storedSection === 'gain' || storedSection === 'loss' || storedSection === 'alpha' ? storedSection : 'hot')
    })
  }, [homeFilterKey, homeQuickActionKey, homeSectionKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activeQuickAction) {
      window.localStorage.setItem(homeQuickActionKey, activeQuickAction)
    } else {
      window.localStorage.removeItem(homeQuickActionKey)
    }
  }, [activeQuickAction, homeQuickActionKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(homeFilterKey, activeFilter)
  }, [activeFilter, homeFilterKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(homeSectionKey, activeSection)
  }, [activeSection, homeSectionKey])

  const sections = useMemo(() => {
    const defaults = [
      { id: 'banner', enabled: true, order: 0 },
      { id: 'tabs', enabled: true, order: 1 },
      { id: 'market', enabled: true, order: 2 },
      { id: 'quickNote', enabled: true, order: 3 },
    ]
    const fromCfg = config?.sections && Array.isArray(config.sections) ? config.sections : defaults
    return [...fromCfg]
      .filter((s) => s && typeof s.id === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((s) => s.enabled !== false)
  }, [config?.sections])

  const homeTabs = useMemo(() => {
    const defaults: Array<{ id: 'hot' | 'alpha' | 'gain' | 'loss' | 'newTokens'; label: string; enabled: boolean }> = [
      { id: 'hot', label: '热门', enabled: true },
      { id: 'alpha', label: '币安Alpha', enabled: true },
      { id: 'gain', label: '涨幅', enabled: true },
      { id: 'loss', label: '跌幅', enabled: true },
      { id: 'newTokens', label: '新币', enabled: true },
    ]
    const fromCfg = systemConfig?.ui?.homeTabs
    const list = Array.isArray(fromCfg) && fromCfg.length > 0 ? fromCfg : defaults
    return list.filter((t) => t.enabled !== false)
  }, [systemConfig?.ui?.homeTabs])

  const homeFilters = useMemo(() => {
    const defaults: Array<{ id: 'all' | 'base' | 'eth' | 'bsc'; label: string; enabled: boolean }> = [
      { id: 'all', label: 'All', enabled: true },
      { id: 'base', label: 'Base', enabled: true },
      { id: 'eth', label: 'ETH', enabled: true },
      { id: 'bsc', label: 'BSC', enabled: true },
    ]
    const fromCfg = systemConfig?.ui?.homeFilters
    const list = Array.isArray(fromCfg) && fromCfg.length > 0 ? fromCfg : defaults
    return list.filter((f) => f.enabled !== false)
  }, [systemConfig?.ui?.homeFilters])

  return (
    <div className="page ave-page ave-home-shell ave-home-v2">
      {config?.notice && (
        <div className="home-status-note">{config.notice}</div>
      )}
      <div className="home-banner-panel">
        <div className="home-banner-copy">
          <div className="home-banner-title">clawdex.me</div>
          <div className="home-banner-desc">{config?.subtitle || '链上实时行情与交易'}</div>
        </div>
        <div className="home-banner-live">APP</div>
      </div>

      <div className="home-price-ticker">
        {topTicker.map((item) => (
          <span key={`t-${item.label}`} className={(item.change ?? 0) >= 0 ? 'up' : 'down'}>
            {item.label} {item.price == null ? '--' : `$${item.price < 1 ? item.price.toFixed(4) : item.price.toFixed(2)}`}
          </span>
        ))}
      </div>

      <div className="ave-home-shot-tabs">
        {homeTabs.map((tab) => {
          if (tab.id === 'newTokens') return <Link key={tab.id} to="/new-tokens">{tab.label}</Link>
          const sectionId: HomeSection = tab.id
          return (
            <button key={tab.id} type="button" className={activeSection === sectionId ? 'active' : ''} onClick={() => setActiveSection(sectionId)}>
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="ave-home-v2-chain-switch">
        {homeFilters.map((f) => (
          <button key={f.id} type="button" className={`home-filter-pill ${activeFilter === f.id ? 'active' : ''}`} onClick={() => setActiveFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <button type="button" className="home-filter-pill-right">价格</button>
        <button type="button" className="home-filter-pill-right">涨幅</button>
      </div>

      <div className="home-market-panel">
        <div className="home-panel-head">
          <div className="home-panel-title">
            {activeSection === 'alpha'
              ? '币安Alpha'
              : activeSection === 'hot'
              ? '代币排行'
              : activeSection === 'gain'
              ? '涨幅排行'
              : '跌幅排行'}
          </div>
          <div className="home-panel-sub">
            {activeSection === 'alpha'
              ? `自动拉取币安 Alpha，按 ${activeFilter === 'all' ? '全链' : activeFilter.toUpperCase()} 展示`
              : activeSection === 'hot'
              ? `按 ${activeFilter === 'all' ? '全链' : activeFilter.toUpperCase()} 展示`
              : activeSection === 'gain'
              ? '24h 涨幅由高到低'
              : '24h 跌幅由高到低'}
          </div>
        </div>
        <div className="home-token-feed">
          {filteredItems.slice(0, 20).map((item) => (
            <Link key={item.id} to={`/market/${encodeURIComponent(item.id)}`} className="home-token-row">
              <div className="home-token-main">
                <img
                  src={item.image?.trim() ? item.image : tokenFallbackSvgDataUrl(item.symbol)}
                  alt=""
                  className="home-token-icon"
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
                  <div className="home-token-name">{item.symbol?.toUpperCase() ?? item.symbol}</div>
                  <div className="home-token-sub">
                    <span>{item.symbol.toUpperCase()}</span>
                    <span className="home-token-sub-sep">/</span>
                    <span>${(item.market_cap / 1e6).toFixed(2)}M</span>
                  </div>
                </div>
              </div>
              <div className="home-token-side">
                <span className="home-token-price">
                  ${item.current_price < 1 ? item.current_price.toFixed(6) : item.current_price.toFixed(4)}
                </span>
                <span className={`home-token-badge ${(item.price_change_percentage_24h ?? 0) >= 0 ? 'up' : 'down'}`}>
                  {(item.price_change_percentage_24h ?? 0) >= 0 ? '+' : ''}
                  {(item.price_change_percentage_24h ?? 0).toFixed(2)}%
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {sections.some((s) => s.id === 'quickNote') && (activeQuickAction === 'receive' || activeQuickAction === 'invite') && (
        <div className="home-status-note">
          {activeQuickAction === 'receive' ? '收款二维码已就绪' : '邀请奖励入口已激活'}
        </div>
      )}
    </div>
  )
}
