import Redis from 'ioredis'
import { fetchDexScreenerAllNewTokens } from '../src/api/dexscreenerNewTokens'

const redis = new Redis(process.env.REDIS_URL!)
const KEY = 'clawdex:new-tokens:latest'
const TTL_SECONDS = 60

export default async function handler(req: any, res: any) {
  try {
    const cached = await redis.get(KEY)
    if (cached) {
      res.status(200).json(JSON.parse(cached))
      return
    }

    const items = await fetchDexScreenerAllNewTokens()
    const payload = { updatedAt: Date.now(), items }
    await redis.set(KEY, JSON.stringify(payload), 'EX', TTL_SECONDS)

    res.status(200).json(payload)
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

