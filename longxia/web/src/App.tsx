import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BrowserRouter, Link, Route, Routes } from "react-router-dom"
import { useAccount, useConnect, useDisconnect } from "wagmi"
import { bsc } from "wagmi/chains"

import { getPreferredInjectedProvider } from "./embeddedWalletBridge"
import CreateTokenPage from "./pages/CreateTokenPage"
import MarketPage from "./pages/MarketPage"
import TokenPage from "./pages/TokenPage"
import PortfolioPage from "./pages/PortfolioPage"

/** 与 vite base 一致；根路径开发时为 undefined */
function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL
  if (!b || b === "/") return undefined
  const s = b.endsWith("/") ? b.slice(0, -1) : b
  return s || undefined
}

function shortAddr(addr?: string) {
  if (!addr) return ""
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function getInjectedProvider(): any {
  return getPreferredInjectedProvider(window)
}

function Header() {
  const { address } = useAccount()
  const { connect, connectors, isPending, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()
  const [menuOpen, setMenuOpen] = useState(false)
  const triedAuto = useRef(false)
  const [injectedReady, setInjectedReady] = useState(false)
  const [noProviderHint, setNoProviderHint] = useState<string | null>(null)

  const isInIframe = (() => {
    try {
      return window.self !== window.top
    } catch {
      return true
    }
  })()

  const hasInjected = injectedReady

  const mobileMenu = menuOpen
    ? createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMenuOpen(false)} role="presentation">
          <div
            className="absolute inset-x-0 top-0 rounded-b-2xl border-b border-neutral-800 bg-neutral-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div />
              <button
                type="button"
                className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
                onClick={() => setMenuOpen(false)}
              >
                X
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              <Link
                to="/"
                className="rounded-xl border border-neutral-700 px-4 py-3 text-base font-semibold text-neutral-100 hover:border-neutral-500 hover:bg-neutral-900"
                onClick={() => setMenuOpen(false)}
              >
                行情
              </Link>
              <Link
                to="/create"
                className="rounded-xl border border-neutral-700 px-4 py-3 text-base font-semibold text-neutral-100 hover:border-neutral-500 hover:bg-neutral-900"
                onClick={() => setMenuOpen(false)}
              >
                发行
              </Link>
              <Link
                to="/portfolio"
                className="rounded-xl border border-neutral-700 px-4 py-3 text-base font-semibold text-neutral-100 hover:border-neutral-500 hover:bg-neutral-900"
                onClick={() => setMenuOpen(false)}
              >
                持仓
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  useEffect(() => {
    let cancelled = false
    let tries = 0
    const poll = () => {
      if (cancelled) return
      const p = getInjectedProvider()
      const ok = !!p?.request
      setInjectedReady(ok)
      tries += 1
      if (ok || tries >= 20) return
      window.setTimeout(poll, 400)
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (address) return
    if (!injectedReady) return
    if (triedAuto.current) return

    const injectedConnector = connectors.find((c) => c.id === "injected")
    if (!injectedConnector) return

    const p = getInjectedProvider()
    if (!p?.request) return

    triedAuto.current = true
    void p
      .request({ method: "eth_accounts" })
      .then((accounts: unknown) => {
        if (Array.isArray(accounts) && accounts.length > 0) {
          connect({ connector: injectedConnector, chainId: bsc.id })
        }
      })
      .catch(() => undefined)
  }, [address, connect, connectors, injectedReady])

  useEffect(() => {
    const p = getInjectedProvider()
    if (!p?.on || !p?.removeListener) return

    const injectedConnector = connectors.find((c) => c.id === "injected")
    if (!injectedConnector) return

    const handleAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
      const first = typeof list[0] === "string" ? (list[0] as string) : null
      if (!first) {
        disconnect()
        return
      }
      if (!address) {
        connect({ connector: injectedConnector, chainId: bsc.id })
      }
    }

    p.on("accountsChanged", handleAccountsChanged)
    return () => {
      p.removeListener("accountsChanged", handleAccountsChanged)
    }
  }, [address, connect, connectors, disconnect])

  const requestTopOpen = () => {
    const url = window.location.href
    try {
      window.parent?.postMessage({ type: "LONGXIA_OPEN_TOP", url }, "*")
    } catch {
    }
  }

  const connectInjected = () => {
    const injectedConnector = connectors.find((c) => c.id === "injected")
    if (!injectedConnector) return

    const p = getInjectedProvider()
    if (p?.request) {
      setNoProviderHint(null)
      void p
        .request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] })
        .catch(() => undefined)
        .finally(() => connect({ connector: injectedConnector, chainId: bsc.id }))
      return
    }
    if (isInIframe) {
      requestTopOpen()
      return
    }
    setNoProviderHint("未检测到钱包注入，请用钱包 App 的 DApp 浏览器打开本页")
  }

  return (
    <div
      className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/70 backdrop-blur"
      style={{ paddingTop: isInIframe ? 0 : 'var(--safe-top)' }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="菜单"
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-200 hover:bg-neutral-900 md:hidden"
            onClick={() => setMenuOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <Link to="/" className="text-base font-semibold tracking-wide">
            龙虾
          </Link>
          <div className="hidden items-center gap-4 md:flex">
            <Link to="/" className="text-sm text-neutral-300 hover:text-white">
              行情
            </Link>
            <Link to="/create" className="text-sm text-neutral-300 hover:text-white">
              发行
            </Link>
            <Link to="/portfolio" className="text-sm text-neutral-300 hover:text-white">
              持仓
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {address ? (
            <button
              type="button"
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              onClick={() => disconnect()}
            >
              {shortAddr(address)}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
              disabled={isPending || (!hasInjected && !isInIframe)}
              onClick={() => {
                if (!hasInjected && isInIframe) {
                  requestTopOpen()
                  return
                }
                connectInjected()
              }}
            >
              {hasInjected ? "连接钱包" : isInIframe ? "全屏打开" : "等待钱包"}
            </button>
          )}
        </div>
      </div>
      {connectError && (
        <div className="mx-auto max-w-7xl px-4 pb-2 text-xs text-red-400 md:px-6">
          {String(connectError).includes("ProviderNotFoundError") ? "未检测到钱包注入 Provider（请用钱包 App 的 DApp 浏览器打开，且不要内嵌）" : String(connectError)}
        </div>
      )}
      {noProviderHint && !connectError && (
        <div className="mx-auto max-w-7xl px-4 pb-2 text-xs text-neutral-400 md:px-6">{noProviderHint}</div>
      )}
      {mobileMenu}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename()}>
      <div className="min-h-[100svh] bg-[radial-gradient(900px_circle_at_10%_0%,rgba(59,130,246,0.10),transparent_55%),radial-gradient(800px_circle_at_95%_15%,rgba(168,85,247,0.08),transparent_55%)]">
        <Header />
        <div className="mx-auto max-w-7xl px-4 py-5 pb-[calc(2.5rem+var(--safe-bottom))] md:px-6">
          <Routes>
            <Route path="/" element={<MarketPage />} />
            <Route path="/create" element={<CreateTokenPage />} />
            <Route path="/token/:token" element={<TokenPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
