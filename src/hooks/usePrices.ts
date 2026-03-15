import { useEffect, useState } from 'react'
import { fetchPrices, getPriceFromMap } from '../api/prices'

export function usePrices() {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchPrices()
      .then((p) => {
        if (!cancelled) setPrices(p)
      })
      .catch(() => {
        if (!cancelled) setPrices({})
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const getPrice = (symbol: string, network?: string) =>
    getPriceFromMap(prices, symbol, network)

  return { prices, loading, getPrice }
}
