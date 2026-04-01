import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
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
import './App.css'

const tabs = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/market', label: '行情', icon: 'market' },
  { to: '/bot', label: 'Bot', icon: 'bot' },
  { to: '/swap', label: '交易', icon: 'swap' },
  { to: '/wallet', label: '钱包', icon: 'wallet' },
]

function TabIcon({ name }: { name: string }) {
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4.75 10.25L12 4.75L19.25 10.25V18.25C19.25 18.8023 18.8023 19.25 18.25 19.25H5.75C5.19772 19.25 4.75 18.8023 4.75 18.25V10.25Z" />
          <path d="M9.25 19.25V13.75C9.25 13.1977 9.69772 12.75 10.25 12.75H13.75C14.3023 12.75 14.75 13.1977 14.75 13.75V19.25" />
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
          <path d="M5.75 17.75L9.25 13.75L12 15.75L17.75 8.75" />
          <path d="M15.75 8.75H17.75V10.75" />
        </svg>
      )
    case 'swap':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 7.75H18.25" />
          <path d="M15.75 5.25L18.25 7.75L15.75 10.25" />
          <path d="M17 16.25H5.75" />
          <path d="M8.25 13.75L5.75 16.25L8.25 18.75" />
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
          <path d="M5.75 8.25C5.75 6.86929 6.86929 5.75 8.25 5.75H16.25C17.6307 5.75 18.75 6.86929 18.75 8.25V15.75C18.75 17.1307 17.6307 18.25 16.25 18.25H8.25C6.86929 18.25 5.75 17.1307 5.75 15.75V8.25Z" />
          <path d="M15.25 12H18.75V14.25H15.25C14.6287 14.25 14.125 13.7463 14.125 13.125V13.125C14.125 12.5037 14.6287 12 15.25 12Z" />
        </svg>
      )
    default:
      return null
  }
}

function AppContent() {
  const location = useLocation()
  const isBot = location.pathname === '/bot'
  const hideNav = location.pathname === '/admin'
  return (
    <>
      <AppHeader />
      <main className={'app-main' + (isBot ? ' app-main-bot' : '')}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/market" element={<MarketsPage />} />
              <Route path="/market/:coinId" element={<MarketDetailPage />} />
              <Route path="/new-tokens" element={<NewTokensPage />} />
              <Route path="/profile" element={<PersonalCenterPage />} />
              <Route path="/bot" element={<BotPage />} />
              <Route path="/swap" element={<SwapPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/*" element={<AdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          {!hideNav && <nav className="ave-bottom-nav" aria-label="底部导航">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) => 'ave-tab' + (isActive ? ' active' : '')}
              >
                <span className={`ave-tab-icon ave-tab-icon-${tab.icon}`} aria-hidden="true">
                  <TabIcon name={tab.icon} />
                </span>
                <span className="ave-tab-label">{tab.label}</span>
              </NavLink>
            ))}
          </nav>}
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <div className="app ave-app">
          <AppContent />
        </div>
      </WalletProvider>
    </BrowserRouter>
  )
}

export default App
