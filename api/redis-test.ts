import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL!)

export default async function handler(req: any, res: any) {
  try {
    const key = 'clawdex:redis-test'
    const value = `pong-${Date.now()}`

    await redis.set(key, value)
    const got = await redis.get(key)

    res.status(200).json({
      ok: true,
      message: 'Redis 连接成功，可以正常读写。',
      wrote: value,
      readBack: got,
      key,
    })
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

