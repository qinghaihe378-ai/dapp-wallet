import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries, CrosshairMode, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, type LineData } from 'lightweight-charts'

export type KLinePeriod = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w'

interface Props {
  syntheticData: { currentPrice: number; change24h: number }
  period?: KLinePeriod
  /** GeckoTerminal 真实 OHLCV：传入 network + poolAddress 会显示真实蜡烛（推荐） */
  geckoPool?: { network: string; poolAddress: string }
  /** DexScreener 实时价格：传入 chainId + tokenAddress 后会显示实时价格线图（非蜡烛） */
  dexScreener?: { chainId: string; tokenAddress: string }
}

const PERIOD_CONFIG: Record<KLinePeriod, { count: number; label: string }> = {
  '1m': { count: 60, label: '1m' },
  '5m': { count: 48, label: '5m' },
  '15m': { count: 56, label: '15m' },
  '1h': { count: 24, label: '1H' },
  '4h': { count: 24, label: '4H' },
  '1d': { count: 7, label: '1D' },
  '1w': { count: 4, label: '1W' },
}

type GeckoTimeframe = 'minute' | 'hour' | 'day'

function toGeckoParams(period: KLinePeriod): { timeframe: GeckoTimeframe; aggregate: number; limit: number; pollMs: number } {
  const limit = Math.min(500, Math.max(60, PERIOD_CONFIG[period].count * 3))
  switch (period) {
    case '1m': return { timeframe: 'minute', aggregate: 1, limit, pollMs: 5000 }
    case '5m': return { timeframe: 'minute', aggregate: 5, limit, pollMs: 7000 }
    case '15m': return { timeframe: 'minute', aggregate: 15, limit, pollMs: 10000 }
    case '1h': return { timeframe: 'hour', aggregate: 1, limit, pollMs: 20000 }
    case '4h': return { timeframe: 'hour', aggregate: 4, limit, pollMs: 30000 }
    case '1d': return { timeframe: 'day', aggregate: 1, limit, pollMs: 60000 }
    case '1w': return { timeframe: 'day', aggregate: 7, limit, pollMs: 120000 }
  }
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
  const intervalSec = period === '1m' ? 60 : period === '5m' ? 300 : period === '15m' ? 900 : period === '1h' ? 3600 : period === '4h' ? 14400 : period === '1d' ? 86400 : 604800

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

export function KLineChart({ syntheticData, period = '1h', geckoPool, dexScreener }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null)
  const [livePricePoints, setLivePricePoints] = useState<LineData[]>([])
  const [geckoCandles, setGeckoCandles] = useState<CandlestickData[]>([])
  const [hoverPrice, setHoverPrice] = useState<number | null>(null)

  const useGeckoOhlcv = Boolean(geckoPool?.network && geckoPool?.poolAddress)
  const useLivePrice = !useGeckoOhlcv && Boolean(syntheticData.currentPrice > 0 && dexScreener)
  const dex = dexScreener
  const gecko = geckoPool

  useEffect(() => {
    if (!gecko?.network || !gecko?.poolAddress) return
    let cancelled = false
    const { timeframe, aggregate, limit, pollMs } = toGeckoParams(period)

    const tick = async () => {
      try {
        const qs = new URLSearchParams({
          network: gecko.network,
          pool: gecko.poolAddress,
          timeframe,
          aggregate: String(aggregate),
          limit: String(limit),
        })
        const r = await fetch(`/api/ohlcv?${qs.toString()}`)
        if (!r.ok) return
        const json = (await r.json()) as {
          ok?: boolean
          data?: { data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } } }
        }
        const list = json?.data?.data?.attributes?.ohlcv_list ?? []
        if (!Array.isArray(list) || list.length === 0) return
        const candles: CandlestickData[] = []
        for (const row of list) {
          const [ts, o, h, l, c] = row
          if (!Number.isFinite(ts) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue
          candles.push({
            time: Math.floor(ts) as UTCTimestamp,
            open: o,
            high: h,
            low: l,
            close: c,
          })
        }
        candles.sort((a, b) => Number(a.time) - Number(b.time))
        if (cancelled) return
        setGeckoCandles(candles)
      } catch {
        // ignore
      }
    }

    void tick()
    const iv = setInterval(tick, pollMs)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [gecko?.network, gecko?.poolAddress, period])

  const liveConfig = useMemo(() => {
    const windowSeconds =
      period === '1m' ? 60 :
      period === '5m' ? 5 * 60 :
      period === '15m' ? 15 * 60 :
      period === '1h' ? 60 * 60 :
      period === '4h' ? 4 * 60 * 60 :
      period === '1d' ? 24 * 60 * 60 :
      7 * 24 * 60 * 60

    // 为避免 1W 数据点爆炸，周期越长，采样间隔越大（仍保持“实时”刷新）
    const stepSeconds =
      period === '1m' ? 5 :
      period === '5m' ? 10 :
      period === '15m' ? 20 :
      period === '1h' ? 60 :
      period === '4h' ? 120 :
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

  const displayCandles = useMemo(() => {
    if (useGeckoOhlcv && geckoCandles.length > 0) return geckoCandles
    return data
  }, [useGeckoOhlcv, geckoCandles, data])

  const hasAnyData =
    (useLivePrice && livePricePoints.length > 0) ||
    (!useLivePrice && displayCandles.length > 0)

  const latestPrice = useMemo(() => {
    if (useLivePrice) {
      const last = livePricePoints[livePricePoints.length - 1]
      return typeof last?.value === 'number' ? last.value : null
    }
    const last = displayCandles[displayCandles.length - 1]
    return last?.close ?? null
  }, [useLivePrice, livePricePoints, displayCandles])

  useEffect(() => {
    if (!containerRef.current || !hasAnyData) return

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
        mode: CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: '#1e2329', color: '#5e6673' },
        horzLine: { labelBackgroundColor: '#1e2329', color: '#5e6673' },
      },
    })

    if (useGeckoOhlcv) {
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#0ecb81',
        downColor: '#f6465d',
        borderUpColor: '#0ecb81',
        borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81',
        wickDownColor: '#f6465d',
      })
      candlestickSeries.setData(displayCandles)
      seriesRef.current = candlestickSeries
    } else if (useLivePrice) {
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
      candlestickSeries.setData(displayCandles)
      seriesRef.current = candlestickSeries
    }
    chart.timeScale().fitContent()
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.seriesData || !seriesRef.current) {
        setHoverPrice(null)
        return
      }
      const dataPoint = param.seriesData.get(seriesRef.current) as { close?: number; value?: number } | undefined
      if (!dataPoint) {
        setHoverPrice(null)
        return
      }
      if (typeof dataPoint.value === 'number') setHoverPrice(dataPoint.value)
      else if (typeof dataPoint.close === 'number') setHoverPrice(dataPoint.close)
      else setHoverPrice(null)
    })

    chartRef.current = chart

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [hasAnyData, useGeckoOhlcv, useLivePrice, displayCandles, livePricePoints, period])

  if (!hasAnyData) return null

  const periodLabel = PERIOD_CONFIG[period].label
  const shownPrice = hoverPrice ?? latestPrice

  return (
    <div>
      <div className="chart-header">
        <div>
          <div className="chart-title">
            {useGeckoOhlcv ? `K 线图 · ${periodLabel}` : useLivePrice ? `实时价格 · ${periodLabel}` : `K 线图 · ${periodLabel}`}
          </div>
          <div className="chart-subtitle">
            {useGeckoOhlcv
              ? 'GeckoTerminal OHLCV（真实蜡烛）'
              : useLivePrice
                ? 'DexScreener 轮询实时价格（非蜡烛 OHLC）'
                : '根据当前价与涨跌幅生成，不依赖外部 API'}
          </div>
        </div>
      </div>
      <div className="ave-kline-wrap">
        {shownPrice !== null && (
          <div className="ave-kline-live-price">
            {shownPrice >= 1 ? shownPrice.toFixed(4) : shownPrice.toFixed(8)}
          </div>
        )}
        <div ref={containerRef} className="ave-kline-container" />
      </div>
    </div>
  )
}
