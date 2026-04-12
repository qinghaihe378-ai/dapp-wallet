import { useEffect, useRef, useState } from "react"
import { BrowserRouter, Link, Route, Routes } from "react-router-dom"
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi"
import { bsc, bscTestnet } from "wagmi/chains"

import CreateTokenPage from "./pages/CreateTokenPage"
import MarketPage from "./pages/MarketPage"
import TokenPage from "./pages/TokenPage"
import PortfolioPage from "./pages/PortfolioPage"

function shortAddr(addr?: string) {
  if (!addr) return ""
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function Header() {
  const { address, chain } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const triedAuto = useRef(false)

  function connectorLabel(id: string, name: string) {
    if (id === "coinbaseWallet") return "Coinbase Wallet"
    if (id === "injected") return "浏览器钱包（小狐狸/TP 等）"
    return name
  }

  useEffect(() => {
    if (address) return
    if (triedAuto.current) return
    triedAuto.current = true

    const injectedConnector = connectors.find((c) => c.id === "injected")
    const eth = (window as unknown as { ethereum?: { request?: (args: { method: string }) => Promise<unknown> } }).ethereum
    if (!injectedConnector || !eth?.request) return

    eth
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (Array.isArray(accounts) && accounts.length > 0) {
          connect({ connector: injectedConnector })
        }
      })
      .catch(() => undefined)
  }, [address, connectors, connect])

  return (
    <div className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/70 backdrop-blur">
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
          {address && (
            <>
              <div className="hidden rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-200 md:block">
                {chain?.name ?? "Unknown"}
              </div>
              <button
                className="hidden rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900 md:block"
                onClick={() => switchChain({ chainId: bsc.id })}
              >
                BSC
              </button>
              <button
                className="hidden rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900 md:block"
                onClick={() => switchChain({ chainId: bscTestnet.id })}
              >
                Testnet
              </button>
            </>
          )}

          {!address ? (
            <>
              <button
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
                disabled={isPending}
                onClick={() => setOpen(true)}
              >
                连接钱包
              </button>
              {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                  <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">选择钱包</div>
                      <button
                        type="button"
                        className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
                        onClick={() => setOpen(false)}
                      >
                        关闭
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {connectors.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full rounded-xl border border-neutral-800 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                          disabled={isPending}
                          onClick={() => {
                            setOpen(false)
                            connect({ connector: c })
                          }}
                        >
                          {connectorLabel(c.id, c.name)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              onClick={() => disconnect()}
            >
              {shortAddr(address)}
            </button>
          )}
        </div>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMenuOpen(false)}>
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
            {address ? (
              <div className="mt-3 grid gap-2">
                <div className="rounded-xl border border-neutral-800 px-3 py-2 text-sm text-neutral-200">
                  {chain?.name ?? "Unknown"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                    onClick={() => switchChain({ chainId: bsc.id })}
                  >
                    BSC
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-neutral-800 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                    onClick={() => switchChain({ chainId: bscTestnet.id })}
                  >
                    Testnet
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[radial-gradient(900px_circle_at_10%_0%,rgba(59,130,246,0.10),transparent_55%),radial-gradient(800px_circle_at_95%_15%,rgba(168,85,247,0.08),transparent_55%)]">
        <Header />
        <div className="mx-auto max-w-7xl px-4 py-5 pb-10 md:px-6">
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
