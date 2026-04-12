import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useWallet } from './WalletProvider'
import { NETWORK_CONFIG, type Network } from '../lib/walletConfig'
import { type MarketItem, searchByAddressOrQuery } from '../api/markets'
import { getLongxiaIframeSrc } from '../lib/longxiaIframeSrc'

const NETWORKS: Network[] = ['mainnet', 'bsc', 'base']

export function AppHeader() {
  const { network, switchNetwork, address } = useWallet()
  const [showNet, setShowNet] = useState(false)
  const [showMarketNet, setShowMarketNet] = useState(false)
  const [marketNetPos, setMarketNetPos] = useState({ top: 0, left: 0 })
  const [netPos, setNetPos] = useState({ top: 0, left: 0 })
  const marketNetBtnRef = useRef<HTMLButtonElement>(null)
  const netBtnRef = useRef<HTMLButtonElement>(null)
  const walletNetBtnRef = useRef<HTMLButtonElement>(null)
  const [homeSearch, setHomeSearch] = useState('')
  const [searchResults, setSearchResults] = useState<MarketItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const isWallet = location.pathname === '/wallet'
  const headerMode = useMemo(() => {
    if (location.pathname === '/') return 'home'
    if (location.pathname === '/market') return 'market'
    if (location.pathname === '/swap') return 'swap'
    if (location.pathname === '/wallet') return 'wallet'
    if (location.pathname === '/bot') return 'bot'
    if (location.pathname === '/new-tokens') return 'track'
    if (location.pathname === '/profile') return 'profile'
    if (location.pathname === '/lobster') return 'longxia'
    return 'detail'
  }, [location.pathname])

  useEffect(() => {
    queueMicrotask(() => {
      setShowNet(false)
      setShowMarketNet(false)
    })
  }, [location.pathname])

  useEffect(() => {
    const q = homeSearch.trim()
    if (!q || q.length < 2) {
      setSearchResults([])
      setShowSearchDropdown(false)
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchLoading(true)
      searchByAddressOrQuery(q)
        .then((data) => {
          setSearchResults(data.slice(0, 8))
          setShowSearchDropdown(data.length > 0)
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false))
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [homeSearch])

  const handleSearchSelect = useCallback(
    (item: MarketItem) => {
      const path = item.id.includes(':') ? `/market/${encodeURIComponent(item.id)}` : `/market/${encodeURIComponent(item.coingeckoId ?? item.id)}`
      navigate(path)
      setHomeSearch('')
      setSearchResults([])
      setShowSearchDropdown(false)
    },
    [navigate]
  )

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useLayoutEffect(() => {
    if (showMarketNet && marketNetBtnRef.current) {
      const rect = marketNetBtnRef.current.getBoundingClientRect()
      setMarketNetPos({ top: rect.bottom + 8, left: rect.left })
    }
  }, [showMarketNet])

  useLayoutEffect(() => {
    const btn = netBtnRef.current ?? walletNetBtnRef.current
    if (showNet && btn) {
      const rect = btn.getBoundingClientRect()
      setNetPos({ top: rect.bottom + 8, left: rect.left })
    }
  }, [showNet])

  const handleNetworkSelect = useCallback(
    (n: Network, close: () => void) => {
      void switchNetwork(n)
      close()
    },
    [switchNetwork]
  )

  const renderNetworkDropdown = (pos: { top: number; left: number }, close: () => void) =>
    showNet &&
    createPortal(
      <div
        className="ave-network-overlay"
        role="presentation"
        onClick={(e) => { if (e.target === e.currentTarget) close() }}
      >
        <div
          className="ave-network-dropdown ave-network-dropdown-portal"
          style={{ top: pos.top, left: pos.left }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitem"
              className={n === network ? 'active' : ''}
              onClick={() => handleNetworkSelect(n, close)}
            >
              {NETWORK_CONFIG[n].chainName}
            </button>
          ))}
        </div>
      </div>,
      document.body
    )

  const networkDropdown = (
    <div className="ave-network-wrap">
      <button
        ref={netBtnRef}
        type="button"
        className="ave-network-btn"
        onClick={() => setShowNet(!showNet)}
        aria-expanded={showNet}
      >
        <span className="ave-network-dot" />
        {NETWORK_CONFIG[network].chainName.replace(' Mainnet', '')}
        <span className="ave-network-arrow">▼</span>
      </button>
      {renderNetworkDropdown(netPos, () => setShowNet(false))}
    </div>
  )

  if (headerMode === 'home') {
    return (
      <header className="ave-header ave-header-home">
        <Link to="/profile" className="ave-home-avatar" aria-label="个人中心" title="ClawDEX">C</Link>
        <div className="ave-home-search-wrap" ref={searchRef}>
          <div className="ave-home-search">
            <span className="ave-home-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              className="ave-home-search-input"
              placeholder="搜索币种/合约地址"
              value={homeSearch}
              onChange={(e) => setHomeSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && homeSearch.trim()) {
                  if (searchResults.length > 0) {
                    handleSearchSelect(searchResults[0])
                  } else {
                    navigate(`/market?q=${encodeURIComponent(homeSearch.trim())}`)
                  }
                }
              }}
              aria-label="搜索币种、合约地址"
              autoComplete="off"
            />
            {searchLoading && <span className="ave-home-search-loading" aria-hidden>...</span>}
          </div>
          {showSearchDropdown && searchResults.length > 0 && (
            <div className="ave-home-search-dropdown">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="ave-home-search-item"
                  onClick={() => handleSearchSelect(item)}
                >
                  <img src={item.image || ''} alt="" className="ave-home-search-item-icon" />
                  <div className="ave-home-search-item-info">
                    <span className="ave-home-search-item-name">{item.symbol?.toUpperCase() ?? item.symbol}</span>
                  </div>
                  <span className="ave-home-search-item-price">
                    ${item.current_price < 1 ? item.current_price.toFixed(6) : item.current_price.toFixed(4)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
    )
  }

  if (headerMode === 'market') {
    const marketNetDropdown = showMarketNet && createPortal(
      <div
        className="ave-network-overlay"
        role="presentation"
        onClick={(e) => { if (e.target === e.currentTarget) setShowMarketNet(false) }}
      >
        <div
          className="ave-network-dropdown ave-header-network-dropdown ave-header-network-dropdown-fixed ave-network-dropdown-portal"
          style={{ top: marketNetPos.top, left: marketNetPos.left }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitem"
              className={n === network ? 'active' : ''}
              onClick={() => handleNetworkSelect(n, () => setShowMarketNet(false))}
            >
              {NETWORK_CONFIG[n].chainName}
            </button>
          ))}
        </div>
      </div>,
      document.body
    )
    return (
      <header className="ave-header ave-header-tabs">
        <div className="ave-header-tabbar">
          <button type="button" className="ave-header-tab active">自选</button>
          <div className="ave-header-tab ave-header-network-wrap">
            <button
              ref={marketNetBtnRef}
              type="button"
              className="ave-header-network-btn"
              onClick={() => setShowMarketNet(!showMarketNet)}
              aria-expanded={showMarketNet}
            >
              {NETWORK_CONFIG[network].chainName.replace(' Mainnet', '')}
              <span className="ave-header-network-arrow">▼</span>
            </button>
          </div>
          {marketNetDropdown}
          <Link to="/new-tokens" className="ave-header-tab">扫链</Link>
        </div>
      </header>
    )
  }

  if (headerMode === 'bot') {
    return (
      <header className="ave-header ave-header-tabs ave-header-swap ave-header-bot">
        <div className="ave-header-tabbar">
          <span className="ave-header-tab active">指令交易</span>
        </div>
      </header>
    )
  }

  if (headerMode === 'swap') {
    return (
      <header className="ave-header ave-header-tabs ave-header-swap">
        <div className="ave-header-tabbar">
          <button type="button" className="ave-header-tab active">兑换</button>
          <div className="ave-header-tab ave-header-network-wrap">
            <button
              ref={netBtnRef}
              type="button"
              className="ave-header-network-btn"
              onClick={() => setShowNet(!showNet)}
              aria-expanded={showNet}
            >
              {NETWORK_CONFIG[network].chainName.replace(' Mainnet', '')}
              <span className="ave-header-network-arrow">▼</span>
            </button>
          </div>
          {renderNetworkDropdown(netPos, () => setShowNet(false))}
        </div>
      </header>
    )
  }

  if (headerMode === 'wallet') {
    return (
      <header className="ave-header ave-header-wallet">
        <div className="ave-network-wrap">
          <button
            ref={walletNetBtnRef}
            type="button"
            className="ave-network-btn ave-network-btn-wallet"
            onClick={() => setShowNet(!showNet)}
            aria-expanded={showNet}
          >
            <span className="ave-network-dot" />
            {NETWORK_CONFIG[network].chainName.replace(' Mainnet', '')}
            <span className="ave-network-arrow">▼</span>
          </button>
          {renderNetworkDropdown(netPos, () => setShowNet(false))}
        </div>
      </header>
    )
  }

  if (headerMode === 'profile') {
    return (
      <header className="ave-header ave-header-detail">
        <div className="ave-header-left">
          <Link to="/" className="ave-back-btn" aria-label="返回">‹</Link>
        </div>
        <div className="ave-header-center">
          <span className="ave-header-page">个人中心</span>
        </div>
        <div className="ave-header-right" />
      </header>
    )
  }

  if (headerMode === 'track') {
    return (
      <header className="ave-header ave-header-tabs">
        <div className="ave-header-tabbar">
          <button type="button" className="ave-header-tab active">追踪</button>
          <button type="button" className="ave-header-tab">新池</button>
          <button type="button" className="ave-header-tab">雷达</button>
        </div>
      </header>
    )
  }

  if (headerMode === 'longxia') {
    const openFull = getLongxiaIframeSrc()
    return (
      <header className="ave-header ave-header-detail">
        <div className="ave-header-left">
          <Link to="/" className="ave-back-btn" aria-label="返回首页">
            ‹
          </Link>
        </div>
        <div className="ave-header-center">
          <span className="ave-header-page">龙虾 · BSC 发币</span>
        </div>
        <div className="ave-header-right">
          <a href={openFull} target="_blank" rel="noopener noreferrer" className="ave-header-action">
            全屏
          </a>
        </div>
      </header>
    )
  }

  return (
    <header className="ave-header ave-header-detail">
      <div className="ave-header-left">{networkDropdown}</div>
      <div className="ave-header-center" />
      <div className="ave-header-right">
        <Link
          to="/wallet"
          className={`ave-wallet-btn ${address ? 'connected' : ''} ${isWallet ? 'active' : ''}`}
          aria-label="钱包"
        >
          <span className="ave-wallet-icon">钱包</span>
          {address && <span className="ave-wallet-dot" />}
        </Link>
      </div>
    </header>
  )
}
