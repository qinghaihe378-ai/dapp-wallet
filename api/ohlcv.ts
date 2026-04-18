import { Redis } from 'ioredis'

const redis = new Redis(process.env.REDIS_URL as string)
const BASE = 'https://api.geckoterminal.com/api/v2'
const ACCEPT = 'application/json;version=20230203'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 30

type Timeframe = 'minute' | 'hour' | 'day'

function clampInt(v: unknown, min: number, max: number, def: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export default async function handler(req: any, res: any) {
  try {
    const sysRaw = await redis.get(SYSTEM_CONFIG_KEY)
    let ttlSeconds = DEFAULT_TTL_SECONDS
    if (sysRaw) {
      try {
        const sys = JSON.parse(sysRaw) as { ohlcv?: { cacheTtlSeconds?: number } }
        ttlSeconds = Math.max(1, Number(sys?.ohlcv?.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS))
      } catch {
        ttlSeconds = DEFAULT_TTL_SECONDS
      }
    }

    const network = String(req?.query?.network ?? '').trim()
    const pool = String(req?.query?.pool ?? '').trim()
    const timeframe = String(req?.query?.timeframe ?? 'minute').trim() as Timeframe
    const aggregate = clampInt(req?.query?.aggregate, 1, 1440, 1)
    const limit = clampInt(req?.query?.limit, 1, 500, 120)

    if (!network || !pool) {
      res.status(400).json({ ok: false, message: 'missing network or pool' })
      return
    }
    if (!['minute', 'hour', 'day'].includes(timeframe)) {
      res.status(400).json({ ok: false, message: 'invalid timeframe' })
      return
    }

    const key = `clawdex:ohlcv:${network}:${pool}:${timeframe}:${aggregate}:${limit}`
    const cached = await redis.get(key)
    if (cached) {
      res.status(200).json(JSON.parse(cached))
      return
    }

    const url = `${BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${encodeURIComponent(timeframe)}?aggregate=${aggregate}&limit=${limit}`
    const r = await fetch(url, { headers: { accept: ACCEPT } })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      res.status(502).json({ ok: false, message: `gecko ${r.status} ${text}` })
      return
    }
    const json = await r.json()
    const payload = { ok: true, updatedAt: Date.now(), data: json }
    await redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds)
    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
