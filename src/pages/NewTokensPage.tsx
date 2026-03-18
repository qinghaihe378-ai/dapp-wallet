import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SUPPORTED_NETWORKS } from '../api/geckoterminal'
import type { NewTokenItem } from '../api/geckoterminal'
import { usePageConfig } from '../hooks/usePageConfig'

const REFRESH_INTERVAL_MS = 30_000
const PRICE_REFRESH_INTERVAL_MS = 45_000
const MAX_PRICE_LOOKUPS_PER_CHAIN = 20

function formatUsd(val: string | null): string {
  if (val == null) return '—'
  const n = Number(val)
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.0001) return n.toFixed(6)
  return n.toExponential(2)
}

export function NewTokensPage() {
  const { config } = usePageConfig('newTokens')
  const [items, setItems] = useState<NewTokenItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [priceMap, setPriceMap] = useState<Record<string, { priceUsd: number; change24h: number | null; at: number }>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/new-tokens')
      if (!res.ok) throw new Error('加载新币失败')
      const data = (await res.json()) as { items?: NewTokenItem[] }
      const list = data.items ?? []
      setItems((prev) => {
        const byKey = new Map<string, NewTokenItem>()
        for (const t of [...list, ...prev]) {
          const key = `${t.chainId}_${t.tokenAddress.toLowerCase()}`
          const existing = byKey.get(key)
          if (!existing || new Date(t.poolCreatedAt) > new Date(existing.poolCreatedAt)) {
            byKey.set(key, t)
          }
        }
        return Array.from(byKey.values()).sort(
          (a, b) => new Date(b.poolCreatedAt).getTime() - new Date(a.poolCreatedAt).getTime(),
        )
      })
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
      setError('拉取新币数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => {
      setLoading(true)
      void load()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  const byChain = useMemo(() => {
    const map = new Map<string, NewTokenItem[]>()
    for (const item of items) {
      const key = item.chainId
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  }, [items])

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
  const keyOf = (chainId: string, addr: string) => `${chainId}:${addr.toLowerCase()}`

  const refreshPrices = useCallback(async () => {
    const now = Date.now()
    const tasks: Array<{ chainId: string; address: string }> = []

    for (const net of SUPPORTED_NETWORKS) {
      const list = byChain.get(net.id) ?? []
      const sliced = list.slice(0, MAX_PRICE_LOOKUPS_PER_CHAIN)
      for (const row of sliced) {
        const k = keyOf(row.chainId, row.tokenAddress)
        const cached = priceMap[k]
        if (cached && now - cached.at < PRICE_REFRESH_INTERVAL_MS) continue
        tasks.push({ chainId: row.chainId, address: row.tokenAddress })
      }
    }

    if (tasks.length === 0) return

    const results: Array<
      | { status: 'fulfilled'; value: { key: string; priceUsd: number; change24h: number | null; at: number } }
      | { status: 'rejected'; reason: unknown }
    > = []
    // 价格刷新逻辑暂时关闭，保留结构以便后续接 DexScreener 行情

    const next: Record<string, { priceUsd: number; change24h: number | null; at: number }> = {}
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue
      next[r.value.key] = { priceUsd: r.value.priceUsd, change24h: r.value.change24h, at: r.value.at }
    }
    if (Object.keys(next).length > 0) {
      setPriceMap((prev) => ({ ...prev, ...next }))
    }
  }, [byChain, priceMap])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await refreshPrices().catch(() => {})
    }
    void run()
    const iv = setInterval(run, PRICE_REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [refreshPrices])

  const sections = useMemo(() => {
    const defaults = [
      { id: 'hero', enabled: true, order: 0 },
      { id: 'chains', enabled: true, order: 1 },
      { id: 'emptyNote', enabled: true, order: 2 },
    ]
    const fromCfg = config?.sections && Array.isArray(config.sections) ? config.sections : defaults
    return [...fromCfg]
      .filter((s) => s && typeof s.id === 'string')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((s) => s.enabled !== false)
  }, [config?.sections])

  return (
    <div className="page ave-page">
      {config?.notice && <p className="tip">{config.notice}</p>}
      {error && <p className="error">{error}</p>}
      {loading && items.length === 0 && <p className="ave-loading">加载中…</p>}

      {sections.map((s) => {
        if (s.id === 'hero') {
          return (
            <section key="hero" className="card new-token-hero">
              <div className="page-header">
                <div className="page-header-main">
                  <span className="page-kicker">Radar</span>
                  <h1 className="page-title">{config?.title || '新池雷达'}</h1>
                  <p className="page-subtitle">{config?.subtitle || '按链聚合 GeckoTerminal 新池数据，移动端改为卡片流展示。'}</p>
                </div>
              </div>
              <div className="wallet-summary">
                <span>每 {REFRESH_INTERVAL_MS / 1000} 秒更新</span>
                {lastRefresh && (
                  <span>上次刷新：{lastRefresh.toLocaleTimeString('zh-CN')}</span>
                )}
              </div>
            </section>
          )
        }
        if (s.id === 'chains') {
          return (
            <div key="chains">
              {SUPPORTED_NETWORKS.map((net) => {
                const list = byChain.get(net.id) ?? []
                if (list.length === 0) return null
                return (
                  <div key={net.id} className="card new-tokens-chain-block">
                    <div className="new-token-chain-header">
                      <h3>{net.name}</h3>
                      <span className="new-token-count">{list.length} 个新池</span>
                    </div>
                    <div className="new-token-list">
                      {list.map((row) => (
                        (() => {
                          const cached = priceMap[keyOf(row.chainId, row.tokenAddress)]
                          const showPrice = cached ? String(cached.priceUsd) : row.priceUsd
                          const showChange =
                            cached && cached.change24h != null ? String(cached.change24h) : row.priceChange24h
                          const isDown = showChange != null && Number(showChange) < 0
                          const isUp = showChange != null && Number(showChange) >= 0
                          return (
                            <Link
                              key={`${row.chainId}_${row.poolAddress}`}
                              to={`/market?q=${encodeURIComponent(row.tokenAddress)}`}
                              className="home-token-row"
                            >
                              <div className="home-token-main">
                                <span className="wallet-token-avatar wallet-token-avatar-violet" aria-hidden="true">
                                  {(row.symbol?.trim()?.[0] ?? '?').toUpperCase()}
                                </span>
                                <div>
                                  <div className="home-token-name">{row.symbol?.toUpperCase() ?? row.symbol}</div>
                                  <div className="home-token-sub">
                                    <span>{row.dexId}</span>
                                    <span className="home-token-sub-sep">·</span>
                                    <span>{shortAddr(row.tokenAddress)}</span>
                                    <span className="home-token-sub-sep">·</span>
                                    <span>流动性 {formatUsd(row.reserveUsd)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="home-token-side">
                                <span className="home-token-price">${formatUsd(showPrice)}</span>
                                <span className={`home-token-badge ${isDown ? 'down' : isUp ? 'up' : 'up'}`}>
                                  {showChange != null ? `${Number(showChange) >= 0 ? '+' : ''}${Number(showChange).toFixed(2)}%` : '—'}
                                </span>
                              </div>
                            </Link>
                          )
                        })()
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        }
        if (s.id === 'emptyNote') {
          if (loading || items.length > 0 || error) return null
          return <p key="emptyNote" className="tip">暂无新池数据，请稍等刷新。</p>
        }
        return null
      })}
    </div>
  )
}
