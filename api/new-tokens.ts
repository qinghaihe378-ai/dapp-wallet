import { Redis } from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens.js'

const redis = new Redis(process.env.REDIS_URL as string)
const KEY = 'clawdex:new-tokens:latest'
const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'
const DEFAULT_TTL_SECONDS = 60

export default async function handler(req: any, res: any) {
  try {
    const sysRaw = await redis.get(SYSTEM_CONFIG_KEY)
    let ttlSeconds = DEFAULT_TTL_SECONDS
    if (sysRaw) {
      try {
        const sys = JSON.parse(sysRaw) as { newTokens?: { cacheTtlSeconds?: number } }
        ttlSeconds = Math.max(1, Number(sys?.newTokens?.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS))
      } catch {
        ttlSeconds = DEFAULT_TTL_SECONDS
      }
    }

    const cached = await redis.get(KEY)
    if (cached) {
      res.status(200).json(JSON.parse(cached))
      return
    }

    const items = await fetchDexScreenerAllNewTokens()
    const payload = { updatedAt: Date.now(), items }
    await redis.set(KEY, JSON.stringify(payload), 'EX', ttlSeconds)

    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}
