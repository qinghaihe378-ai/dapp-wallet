import { useEffect, useState } from 'react'
import { getPublicSystemConfig, type ApiSystemConfig } from '../api/admin'

export function useSystemConfig() {
  const [config, setConfig] = useState<ApiSystemConfig | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const res = await getPublicSystemConfig()
        if (!cancelled) setConfig(res.config ?? null)
      } catch {
        if (!cancelled) setConfig(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return { config, loading }
}
