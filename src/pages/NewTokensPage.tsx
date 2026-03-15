import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllNewTokens, SUPPORTED_NETWORKS } from '../api/geckoterminal'
import type { NewTokenItem } from '../api/geckoterminal'

const REFRESH_INTERVAL_MS = 30_000

function formatUsd(val: string | null): string {
  if (val == null) return '—'
  const n = Number(val)
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.0001) return n.toFixed(6)
  return n.toExponential(2)
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NewTokensPage() {
  const [items, setItems] = useState<NewTokenItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const list = await fetchAllNewTokens()
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

  return (
    <div className="page ave-page">
      <section className="card new-token-hero">
        <div className="page-header">
          <div className="page-header-main">
            <span className="page-kicker">Radar</span>
            <h1 className="page-title">新池雷达</h1>
            <p className="page-subtitle">按链聚合 GeckoTerminal 新池数据，移动端改为卡片流展示。</p>
          </div>
        </div>
        <div className="wallet-summary">
          <span>每 {REFRESH_INTERVAL_MS / 1000} 秒更新</span>
          {lastRefresh && (
            <span>上次刷新：{lastRefresh.toLocaleTimeString('zh-CN')}</span>
          )}
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {loading && items.length === 0 && <p className="ave-loading">加载中…</p>}

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
                <div key={`${row.chainId}_${row.poolAddress}`} className="new-token-card">
                  <div className="new-token-top">
                    <div>
                      <div className="new-token-symbol">{row.symbol}</div>
                      <div className="new-token-dex">{row.dexId}</div>
                    </div>
                    <div className={row.priceChange24h != null && Number(row.priceChange24h) < 0 ? 'down' : 'up'}>
                      {row.priceChange24h != null ? `${row.priceChange24h}%` : '—'}
                    </div>
                  </div>
                  <code className="addr">
                    {row.tokenAddress.slice(0, 6)}...{row.tokenAddress.slice(-4)}
                  </code>
                  <div className="new-token-grid">
                    <div className="metric-card">
                      <span className="metric-label">价格</span>
                      <span className="metric-value">{formatUsd(row.priceUsd)}</span>
                    </div>
                    <div className="metric-card">
                      <span className="metric-label">FDV</span>
                      <span className="metric-value">{formatUsd(row.fdvUsd)}</span>
                    </div>
                    <div className="metric-card">
                      <span className="metric-label">流动性</span>
                      <span className="metric-value">{formatUsd(row.reserveUsd)}</span>
                    </div>
                    <div className="metric-card">
                      <span className="metric-label">发现时间</span>
                      <span className="metric-value">{formatTime(row.poolCreatedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {!loading && items.length === 0 && !error && (
        <p className="tip">暂无新池数据，请稍等刷新。</p>
      )}
    </div>
  )
}
