import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { AppHeader } from './components/AppHeader'
import { WalletProvider } from './components/WalletProvider'
import { HomePage } from './pages/HomePage'
import { MarketDetailPage } from './pages/MarketDetailPage'
import { MarketsPage } from './pages/MarketsPage'
import { NewTokensPage } from './pages/NewTokensPage'
import { PersonalCenterPage } from './pages/PersonalCenterPage'
import { BotPage } from './pages/BotPage'
import { SwapPage } from './pages/SwapPage'
import { WalletPage } from './pages/WalletPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminPage } from './pages/AdminPage'
import { LongxiaEmbedPage } from './pages/LongxiaEmbedPage'
import { useSystemConfig } from './hooks/useSystemConfig'
import './App.css'

type BottomTabItem = {
  id: string
  to: string
  label: string
  icon: string
  enabled: boolean
}

const tabs: BottomTabItem[] = [
  { id: 'home', to: '/', label: '首页', icon: 'home', enabled: true },
  { id: 'market', to: '/market', label: '行情', icon: 'market', enabled: true },
  { id: 'bot', to: '/bot', label: 'Bot', icon: 'bot', enabled: true },
  { id: 'swap', to: '/swap', label: '交易', icon: 'swap', enabled: true },
  { id: 'wallet', to: '/wallet', label: '钱包', icon: 'wallet', enabled: true },
]


function TabIcon({ name }: { name: string }) {
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4.75 10.5L12 4.75L19.25 10.5V18.25C19.25 18.8023 18.8023 19.25 18.25 19.25H5.75C5.19772 19.25 4.75 18.8023 4.75 18.25V10.5Z" />
          <path d="M9.75 19.25V14.25C9.75 13.6977 10.1977 13.25 10.75 13.25H13.25C13.8023 13.25 14.25 13.6977 14.25 14.25V19.25" />
        </svg>
      )
    case 'bot':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="8.5" cy="16" r="1" fill="currentColor" />
          <circle cx="15.5" cy="16" r="1" fill="currentColor" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      )
    case 'market':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6.75 16.75V12.75" />
          <path d="M11.75 16.75V9.75" />
          <path d="M16.75 16.75V6.75" />
          <path d="M5.25 18.25H18.75" />
        </svg>
      )
    case 'swap':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6.25 8.25H16.75" />
          <path d="M13.75 5.25L16.75 8.25L13.75 11.25" />
          <path d="M17.75 15.75H7.25" />
          <path d="M10.25 12.75L7.25 15.75L10.25 18.75" />
        </svg>
      )
    case 'track':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7.25 5.75H16.75C18.1307 5.75 19.25 6.86929 19.25 8.25V15.75C19.25 17.1307 18.1307 18.25 16.75 18.25H7.25C5.86929 18.25 4.75 17.1307 4.75 15.75V8.25C4.75 6.86929 5.86929 5.75 7.25 5.75Z" />
          <path d="M8.25 14.25L10.75 11.75L12.75 13.25L15.75 9.75" />
        </svg>
      )
    case 'wallet':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4.75" y="6.75" width="14.5" height="10.5" rx="2.5" />
          <path d="M4.75 9.25H19.25" />
          <path d="M15.5 13.25H16.75" />
        </svg>
      )
    case 'lobster':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5.5c-2.5 0-4.5 2-4.5 4.5 0 1.2.5 2.3 1.3 3.1L8 18l4-1.5 4 1.5-1-5c.8-.8 1.3-1.9 1.3-3.1 0-2.5-2-4.5-4.5-4.5z" />
          <path d="M9.5 10h5M10 7.5h4" />
        </svg>
      )
    default:
      return null
  }
}

function AppContent() {
  const { config: systemConfig } = useSystemConfig()
  const location = useLocation()
  const isBot = location.pathname === '/bot'
  const isLobsterEmbed = location.pathname === '/lobster'
  const isMarketDetail = /^\/market\/[^/]+$/.test(location.pathname)
  const isMarketList = location.pathname === '/market'
  const isSwapPage = location.pathname === '/swap'
  const isProfilePage = location.pathname === '/profile'
  const routeToggles = systemConfig?.ui?.routeToggles
  const dynamicTabs = (systemConfig?.ui?.bottomTabs && Array.isArray(systemConfig.ui.bottomTabs) ? systemConfig.ui.bottomTabs : tabs)
    .filter((tab) => tab && tab.enabled !== false)
  const hideNav = location.pathname === '/admin' || isMarketDetail
  const hideHeader = location.pathname === '/admin' || isLobsterEmbed || isMarketDetail
  return (
    <>
      {!hideHeader && <AppHeader />}
      <main
        className={
          'app-main' +
          (isBot ? ' app-main-bot' : '') +
          (isMarketList ? ' app-main-market' : '') +
          (isSwapPage ? ' app-main-swap' : '') +
          (isProfilePage ? ' app-main-profile' : '') +
          (isLobsterEmbed ? ' app-main-longxia-embed' : '') +
          (isMarketDetail ? ' app-main-market-detail' : '')
        }
      >
            <Routes>
              <Route path="/" element={<HomePage />} />
              {routeToggles?.market !== false && <Route path="/market" element={<MarketsPage />} />}
              <Route path="/market/:coinId" element={<MarketDetailPage />} />
              {routeToggles?.newTokens !== false && <Route path="/new-tokens" element={<NewTokensPage />} />}
              {routeToggles?.profile !== false && <Route path="/profile" element={<PersonalCenterPage />} />}
              <Route path="/lobster" element={<LongxiaEmbedPage />} />
              {routeToggles?.bot !== false && <Route path="/bot" element={<BotPage />} />}
              {routeToggles?.swap !== false && <Route path="/swap" element={<SwapPage />} />}
              {routeToggles?.wallet !== false && <Route path="/wallet" element={<WalletPage />} />}
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          {!hideNav && <nav className="ave-bottom-nav" aria-label="底部导航">
            {dynamicTabs.map((tab) => (
              <NavLink
                key={tab.id ?? tab.to}
                to={tab.to as string}
                className={({ isActive }) => 'ave-tab' + (isActive ? ' active' : '')}
              >
                <span className={`ave-tab-icon ave-tab-icon-${tab.icon as string}`} aria-hidden="true">
                  <TabIcon name={tab.icon as string} />
                </span>
                <span className="ave-tab-label">{tab.label as string}</span>
              </NavLink>
            ))}
          </nav>}
    </>
  )
}

function App() {
  return (
    <HashRouter>
      <WalletProvider>
        <div className="app ave-app">
          <AppContent />
        </div>
      </WalletProvider>
    </HashRouter>
  )
}

export default App
