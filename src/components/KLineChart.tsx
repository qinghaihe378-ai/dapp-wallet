import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, type LineData } from 'lightweight-charts'

export type KLinePeriod = '1m' | '5m' | '30m' | '1h' | '2h' | '1d' | '1w'

interface Props {
  syntheticData: { currentPrice: number; change24h: number }
  period?: KLinePeriod
  /** DexScreener 实时价格：传入 chainId + tokenAddress 后会显示实时价格线图（非蜡烛） */
  dexScreener?: { chainId: string; tokenAddress: string }
}

const PERIOD_CONFIG: Record<KLinePeriod, { count: number; label: string }> = {
  '1m': { count: 60, label: '1m' },
  '5m': { count: 48, label: '5m' },
  '30m': { count: 48, label: '30m' },
  '1h': { count: 24, label: '1H' },
  '2h': { count: 24, label: '2H' },
  '1d': { count: 7, label: '1D' },
  '1w': { count: 4, label: '1W' },
}

/** 根据当前价和 24h 涨跌幅生成 OHLC 蜡烛数据 */
function generateSyntheticOHLC(
  currentPrice: number,
  change24h: number,
  period: KLinePeriod
): CandlestickData[] {
  const { count } = PERIOD_CONFIG[period]
  const startPrice = change24h !== 0
    ? currentPrice / (1 + change24h / 100)
    : currentPrice
  const range = currentPrice - startPrice
  const candles: CandlestickData[] = []
  let prevClose = startPrice
  const now = Math.floor(Date.now() / 1000)
  const intervalSec = period === '1m' ? 60 : period === '5m' ? 300 : period === '30m' ? 1800 : period === '1h' ? 3600 : period === '2h' ? 7200 : period === '1d' ? 86400 : 604800

  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count
    const trend = startPrice + range * t
    const volatility = Math.abs(range) * 0.025 * (0.5 + Math.sin(i * 1.7) * 0.5)
    const open = prevClose
    const close = trend + (Math.sin(i * 2.3) * 0.5) * volatility
    const high = Math.max(open, close) + Math.abs(Math.sin(i * 1.1)) * volatility
    const low = Math.min(open, close) - Math.abs(Math.cos(i * 0.9)) * volatility
    prevClose = close

    const time = (now - (count - i - 1) * intervalSec) as UTCTimestamp
    candles.push({
      time,
      open: Math.max(open, currentPrice * 0.001),
      high: Math.max(high, currentPrice * 0.001),
      low: Math.max(low, currentPrice * 0.001),
      close: Math.max(close, currentPrice * 0.001),
    })
  }
  return candles
}

export function KLineChart({ syntheticData, period = '1h', dexScreener }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null)
  const [livePricePoints, setLivePricePoints] = useState<LineData[]>([])

  const useLivePrice = Boolean(syntheticData.currentPrice > 0 && dexScreener)
  const dex = dexScreener

  const liveConfig = useMemo(() => {
    const windowSeconds =
      period === '1m' ? 60 :
      period === '5m' ? 5 * 60 :
      period === '30m' ? 30 * 60 :
      period === '1h' ? 60 * 60 :
      period === '2h' ? 2 * 60 * 60 :
      period === '1d' ? 24 * 60 * 60 :
      7 * 24 * 60 * 60

    // 为避免 1W 数据点爆炸，周期越长，采样间隔越大（仍保持“实时”刷新）
    const stepSeconds =
      period === '1m' ? 5 :
      period === '5m' ? 10 :
      period === '30m' ? 30 :
      period === '1h' ? 60 :
      period === '2h' ? 90 :
      period === '1d' ? 5 * 60 :
      30 * 60

    const maxPoints = Math.min(480, Math.max(12, Math.floor(windowSeconds / stepSeconds)))
    const pollMs = Math.max(5000, stepSeconds * 1000)
    return { windowSeconds, stepSeconds, maxPoints, pollMs }
  }, [period])

  useEffect(() => {
    // 切周期时清空点，避免“1m 看起来像 1h”
    if (!dex) return
    setLivePricePoints([])
  }, [dex?.chainId, dex?.tokenAddress, period])

  useEffect(() => {
    if (!dex) return
    let cancelled = false
    let pairId: string | null = null

    const resolvePairId = async () => {
      const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${dex.chainId}/${dex.tokenAddress}`)
      if (!res.ok) throw new Error('DexScreener token-pairs 失败')
      const json = (await res.json()) as Array<{ pairAddress?: string } | null>
      const first = Array.isArray(json) ? json.find((p) => p?.pairAddress) : null
      pairId = (first as { pairAddress?: string } | null)?.pairAddress ?? null
    }

    const tick = async () => {
      if (!dex) return
      try {
        if (!pairId) await resolvePairId()
        if (!pairId) return
        const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dex.chainId}/${pairId}`)
        if (!res.ok) return
        const json = (await res.json()) as { pairs?: Array<{ priceUsd?: string }> }
        const priceStr = json?.pairs?.[0]?.priceUsd
        const price = priceStr ? parseFloat(priceStr) : NaN
        if (!Number.isFinite(price) || price <= 0) return
        const t = Math.floor(Date.now() / 1000) as UTCTimestamp
        if (cancelled) return
        setLivePricePoints((prev) => {
          const next = [...prev, { time: t, value: price }]
          // 去重同秒
          const dedup: LineData[] = []
          for (const p of next) {
            const last = dedup[dedup.length - 1]
            if (last && last.time === p.time) {
              dedup[dedup.length - 1] = p
            } else {
              dedup.push(p)
            }
          }
          return dedup.slice(-liveConfig.maxPoints)
        })
      } catch {
        // ignore
      }
    }

    void tick()
    const iv = setInterval(tick, liveConfig.pollMs)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [dex?.chainId, dex?.tokenAddress, liveConfig.maxPoints, liveConfig.pollMs])

  const data = useMemo(() => {
    if (syntheticData.currentPrice <= 0) return []
    return generateSyntheticOHLC(syntheticData.currentPrice, syntheticData.change24h, period)
  }, [syntheticData.currentPrice, syntheticData.change24h, period])

  useEffect(() => {
    if (!containerRef.current || (useLivePrice ? livePricePoints.length === 0 : data.length === 0)) return

    const container = containerRef.current
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        attributionLogo: false,
        // Binance-like dark theme
        background: { color: '#0b0e11' },
        textColor: '#b7bdc6',
        fontFamily: 'inherit',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2329' },
        horzLines: { color: '#1e2329' },
      },
      rightPriceScale: {
        borderColor: '#1e2329',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1e2329',
        timeVisible: true,
        secondsVisible: period === '1m' || period === '5m',
      },
      crosshair: {
        vertLine: { labelBackgroundColor: '#1e2329', color: '#5e6673' },
        horzLine: { labelBackgroundColor: '#1e2329', color: '#5e6673' },
      },
    })

    if (useLivePrice) {
      const line = chart.addSeries(LineSeries, {
        color: '#f0b90b',
        lineWidth: 2,
        priceLineColor: '#f0b90b',
        lastValueVisible: true,
      })
      line.setData(livePricePoints)
      seriesRef.current = line
    } else {
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#0ecb81',
        downColor: '#f6465d',
        borderUpColor: '#0ecb81',
        borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81',
        wickDownColor: '#f6465d',
      })
      candlestickSeries.setData(data)
      seriesRef.current = candlestickSeries
    }
    chart.timeScale().fitContent()

    chartRef.current = chart

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [data, livePricePoints, useLivePrice])

  if ((useLivePrice && livePricePoints.length === 0) || (!useLivePrice && data.length === 0)) return null

  const periodLabel = PERIOD_CONFIG[period].label

  return (
    <div>
      <div className="chart-header">
        <div>
          <div className="chart-title">{useLivePrice ? `实时价格 · ${periodLabel}` : `K 线图 · ${periodLabel}`}</div>
          <div className="chart-subtitle">
            {useLivePrice ? 'DexScreener 轮询实时价格（非蜡烛 OHLC）' : '根据当前价与涨跌幅生成，不依赖外部 API'}
          </div>
        </div>
      </div>
      <div ref={containerRef} className="ave-kline-container" />
    </div>
  )
}
