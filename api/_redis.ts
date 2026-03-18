import { Redis } from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL as string)

export function pageConfigKey(pageId: string) {
  return `clawdex:pageConfig:${pageId}`
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setJson(key: string, value: unknown, ttlSeconds?: number) {
  const raw = JSON.stringify(value)
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, raw, 'EX', ttlSeconds)
  } else {
    await redis.set(key, raw)
  }
}

