import { useEffect, useState } from 'react'
import { getPublicPageConfig, type PageConfig, type PageId } from '../api/admin'

export function usePageConfig(page: PageId) {
  const [config, setConfig] = useState<PageConfig | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await getPublicPageConfig(page)
        if (cancelled) return
        setConfig(res.config ?? null)
      } catch {
        if (!cancelled) setConfig(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [page])

  return { config, loading }
}

