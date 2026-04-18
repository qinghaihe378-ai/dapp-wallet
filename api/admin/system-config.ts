import { requireAdmin } from '../_auth.js'
import { getJson, setJson } from '../_redis.js'

const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'

function normalizeConfig(raw: any) {
  const market = raw?.market ?? {}
  const sourceToggles = market?.sourceToggles ?? {}
  const newTokens = raw?.newTokens ?? {}
  const ohlcv = raw?.ohlcv ?? {}
  const apiKeys = raw?.apiKeys ?? {}
  return {
    market: {
      cacheTtlSeconds: Number(market.cacheTtlSeconds ?? 12) || 12,
      freshMs: Number(market.freshMs ?? 10_000) || 10_000,
      enableAlpha: market.enableAlpha !== false,
      retries: Number(market.retries ?? 1) || 1,
      sourceToggles: {
        dexScreener: sourceToggles.dexScreener !== false,
        birdeye: sourceToggles.birdeye !== false,
        coinGecko: sourceToggles.coinGecko !== false,
        coinPaprika: sourceToggles.coinPaprika !== false,
        coinCap: sourceToggles.coinCap !== false,
      },
    },
    newTokens: {
      cacheTtlSeconds: Number(newTokens.cacheTtlSeconds ?? 60) || 60,
    },
    ohlcv: {
      cacheTtlSeconds: Number(ohlcv.cacheTtlSeconds ?? 30) || 30,
    },
    apiKeys: {
      birdeyeApiKey: String(apiKeys.birdeyeApiKey ?? '').trim(),
    },
    updatedAt: Date.now(),
  }
}

export default async function handler(req: any, res: any) {
  try {
    requireAdmin(req)
    const method = String(req?.method ?? 'GET').toUpperCase()

    if (method === 'GET') {
      const config = await getJson<any>(SYSTEM_CONFIG_KEY)
      res.status(200).json({ ok: true, config })
      return
    }

    if (method === 'PUT' || method === 'POST') {
      const body = typeof req?.body === 'string' ? JSON.parse(req.body) : (req?.body ?? {})
      const config = normalizeConfig(body?.config ?? {})
      await setJson(SYSTEM_CONFIG_KEY, config)
      res.status(200).json({ ok: true, config })
      return
    }

    res.status(405).json({ ok: false, message: 'Method Not Allowed' })
  } catch (e) {
    const status = (e as any)?.statusCode
    if (status === 401) {
      res.status(401).json({ ok: false, message: 'unauthorized' })
      return
    }
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
