import { useEffect, useMemo, useRef } from 'react'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp } from 'lightweight-charts'

export type KLinePeriod = '1m' | '5m' | '30m' | '1h' | '2h' | '1d' | '1w'

interface Props {
  syntheticData: { currentPrice: number; change24h: number }
  period?: KLinePeriod
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

export function KLineChart({ syntheticData, period = '1h' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const data = useMemo(() => {
    if (syntheticData.currentPrice <= 0) return []
    return generateSyntheticOHLC(
      syntheticData.currentPrice,
      syntheticData.change24h,
      period
    )
  }, [syntheticData.currentPrice, syntheticData.change24h, period])

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    const container = containerRef.current
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        attributionLogo: false,
        background: { color: 'transparent' },
        textColor: '#70809f',
        fontFamily: 'inherit',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      rightPriceScale: {
        borderColor: 'transparent',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'transparent',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { labelBackgroundColor: 'rgba(11, 19, 35, 0.9)' },
        horzLine: { labelBackgroundColor: 'rgba(11, 19, 35, 0.9)' },
      },
    })

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    candlestickSeries.setData(data)
    chart.timeScale().fitContent()

    chartRef.current = chart
    seriesRef.current = candlestickSeries

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [data])

  if (data.length === 0) return null

  const periodLabel = PERIOD_CONFIG[period].label

  return (
    <div>
      <div className="chart-header">
        <div>
          <div className="chart-title">K 线图 · {periodLabel}</div>
          <div className="chart-subtitle">根据当前价与涨跌幅生成，不依赖外部 API</div>
        </div>
      </div>
      <div ref={containerRef} className="ave-kline-container" />
    </div>
  )
}
