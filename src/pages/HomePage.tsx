import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { COLLECTION_INTERVAL_MS } from '../api/markets'
import { apiUrl } from '../lib/apiBase'
import { usePageConfig } from '../hooks/usePageConfig'

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

const HOME_QUICK_ACTION_KEY_PREFIX = 'homeQuickAction'
const HOME_FILTER_KEY_PREFIX = 'homeActiveFilter'
const HOME_SECTION_KEY_PREFIX = 'homeActiveSection'

function hasTokenAvatar(image: string | undefined | null): boolean {
  if (image == null || typeof image !== 'string') return false
  return image.trim().length > 0
}

export function HomePage() {
  const { network } = useWallet()
  const { config } = usePageConfig('home')
  const homeQuickActionKey = `${HOME_QUICK_ACTION_KEY_PREFIX}:${network}`
  const homeFilterKey = `${HOME_FILTER_KEY_PREFIX}:${network}`
  const homeSectionKey = `${HOME_SECTION_KEY_PREFIX}:${network}`
  const [items, setItems] = useState<HomeItem[]>([])
  const [activeSection, setActiveSection] = useState<'hot' | 'gain'>(() => {
    if (typeof window === 'undefined') return 'hot'
    const stored = window.localStorage.getItem(homeSectionKey)
    return stored === 'gain' ? 'gain' : 'hot'
  })
  const [activeQuickAction, setActiveQuickAction] = useState<'receive' | 'invite' | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(homeQuickActionKey)
    return stored === 'receive' || stored === 'invite' ? stored : null
  })
  const [activeFilter, setActiveFilter] = useState<'all' | 'eth' | 'bsc' | 'base'>(() => {
    if (typeof window === 'undefined') return 'all'
    const stored = window.localStorage.getItem(homeFilterKey)
    if (stored === 'sol') return 'all'
    return stored === 'eth' || stored === 'bsc' || stored === 'base' || stored === 'all' ? stored : 'all'
  })
  const baseFiltered =
    activeFilter === 'all'
      ? items
      : items.filter((item) => {
          const chain = item.chain?.toLowerCase()
          if (activeFilter === 'eth') return chain === 'eth' || chain === 'btc'
          if (activeFilter === 'bsc') return chain === 'bsc'
          if (activeFilter === 'base') return chain === 'base'
          return true
        })
  const filteredItems = useMemo(() => {
    if (activeSection === 'gain') {
      return [...baseFiltered].sort(
        (a, b) => (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity)
      )
    }
    // 热门：仅展示有头像（非空 image）的代币
    return baseFiltered.filter((item) => hasTokenAvatar(item.image))
  }, [activeSection, baseFiltered])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/api/market?chain=all'))
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
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedQuickAction = window.localStorage.getItem(homeQuickActionKey)
    const storedFilter = window.localStorage.getItem(homeFilterKey)
    const storedSection = window.localStorage.getItem(homeSectionKey)
    queueMicrotask(() => {
      setActiveQuickAction(storedQuickAction === 'receive' || storedQuickAction === 'invite' ? storedQuickAction : null)
      setActiveFilter(
        storedFilter === 'sol'
          ? 'all'
          : storedFilter === 'eth' || storedFilter === 'bsc' || storedFilter === 'base' || storedFilter === 'all'
            ? storedFilter
            : 'all',
      )
      setActiveSection(storedSection === 'gain' ? 'gain' : 'hot')
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

  return (
    <div className="page ave-page ave-home-shell">
      {config?.notice && (
        <div className="home-status-note">{config.notice}</div>
      )}

      {sections.map((s) => {
        if (s.id === 'banner') {
          return (
            <div key="banner" className="home-banner-panel">
              <div className="home-banner-copy">
                <div className="home-banner-title">{config?.title || 'ClawDEX'}</div>
                <div className="home-banner-desc">{config?.subtitle || '合约直播 · 看见交易的另一种可能'}</div>
                <div className="home-banner-metrics">
                  <span>实时广播</span>
                  <span>高手跟单</span>
                </div>
              </div>
              <div className="home-banner-live">LIVE</div>
            </div>
          )
        }
        if (s.id === 'tabs') {
          return (
            <div key="tabs" className="home-section-tabs">
              <button type="button" className={activeSection === 'hot' ? 'active' : ''} onClick={() => setActiveSection('hot')}>热门</button>
              <button type="button" className={activeSection === 'gain' ? 'active' : ''} onClick={() => setActiveSection('gain')}>涨幅</button>
              <Link to="/new-tokens" className="ave-header-tab home-section-tab-link">新币</Link>
            </div>
          )
        }
        if (s.id === 'market') {
          return (
            <div key="market" className="home-market-panel">
              <div className="home-panel-head">
                <div className="home-panel-title">
                  {activeSection === 'hot' ? '热门列表' : '涨幅排行'}
                </div>
                <div className="home-panel-sub">
                  {activeSection === 'hot' && (activeFilter === 'all' ? '全链热门' : `${activeFilter.toUpperCase()} 热门`)}
                  {activeSection === 'gain' && '24h 涨幅高到低'}
                </div>
              </div>

              <div className="home-filter-strip">
                <button type="button" className={`home-filter-pill ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>All</button>
                <button type="button" className={`home-filter-pill ${activeFilter === 'eth' ? 'active' : ''}`} onClick={() => setActiveFilter('eth')}>ETH</button>
                <button type="button" className={`home-filter-pill ${activeFilter === 'bsc' ? 'active' : ''}`} onClick={() => setActiveFilter('bsc')}>BSC</button>
                <button type="button" className={`home-filter-pill ${activeFilter === 'base' ? 'active' : ''}`} onClick={() => setActiveFilter('base')}>Base</button>
                <span className="home-filter-caption">价格</span>
                <span className="home-filter-caption">涨幅</span>
              </div>

              <div className="home-token-feed">
                {filteredItems.map((item) => (
                  <Link key={item.id} to={`/market/${encodeURIComponent(item.id)}`} className="home-token-row">
                    <div className="home-token-main">
                      <img src={item.image} alt="" className="home-token-icon" />
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
          )
        }
        if (s.id === 'quickNote') {
          if (!(activeQuickAction === 'receive' || activeQuickAction === 'invite')) return null
          return (
            <div key="quickNote" className="home-status-note">
              {activeQuickAction === 'receive' ? '收款二维码已就绪' : '邀请奖励入口已激活'}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
