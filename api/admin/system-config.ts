import { requireAdmin } from '../_auth.js'
import { getJson, setJson } from '../_redis.js'

const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'

function normalizeConfig(raw: any) {
  const market = raw?.market ?? {}
  const sourceToggles = market?.sourceToggles ?? {}
  const newTokens = raw?.newTokens ?? {}
  const ohlcv = raw?.ohlcv ?? {}
  const apiKeys = raw?.apiKeys ?? {}
  const ui = raw?.ui ?? {}
  const bottomTabs = Array.isArray(ui?.bottomTabs) ? ui.bottomTabs : []
  const homeTabs = Array.isArray(ui?.homeTabs) ? ui.homeTabs : []
  const homeFilters = Array.isArray(ui?.homeFilters) ? ui.homeFilters : []
  const routeToggles = ui?.routeToggles ?? {}
  const normalizeNavItem = (it: any, def: { id: string; to: string; label: string; icon: string; enabled: boolean }) => ({
    id: String(it?.id ?? def.id),
    to: String(it?.to ?? def.to),
    label: String(it?.label ?? def.label),
    icon: String(it?.icon ?? def.icon),
    enabled: it?.enabled !== false,
  })
  const normalizeSimple = (it: any, def: { id: string; label: string; enabled: boolean }) => ({
    id: String(it?.id ?? def.id),
    label: String(it?.label ?? def.label),
    enabled: it?.enabled !== false,
  })
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
    ui: {
      bottomTabs: [
        normalizeNavItem(bottomTabs[0], { id: 'home', to: '/', label: '首页', icon: 'home', enabled: true }),
        normalizeNavItem(bottomTabs[1], { id: 'market', to: '/market', label: '行情', icon: 'market', enabled: true }),
        normalizeNavItem(bottomTabs[2], { id: 'bot', to: '/bot', label: 'Bot', icon: 'bot', enabled: true }),
        normalizeNavItem(bottomTabs[3], { id: 'swap', to: '/swap', label: '交易', icon: 'swap', enabled: true }),
        normalizeNavItem(bottomTabs[4], { id: 'wallet', to: '/wallet', label: '钱包', icon: 'wallet', enabled: true }),
      ],
      homeTabs: [
        normalizeSimple(homeTabs[0], { id: 'hot', label: '热门', enabled: true }),
        normalizeSimple(homeTabs[1], { id: 'alpha', label: '币安Alpha', enabled: true }),
        normalizeSimple(homeTabs[2], { id: 'gain', label: '涨幅', enabled: true }),
        normalizeSimple(homeTabs[3], { id: 'loss', label: '跌幅', enabled: true }),
        normalizeSimple(homeTabs[4], { id: 'newTokens', label: '新币', enabled: true }),
      ],
      homeFilters: [
        normalizeSimple(homeFilters[0], { id: 'all', label: 'All', enabled: true }),
        normalizeSimple(homeFilters[1], { id: 'base', label: 'Base', enabled: true }),
        normalizeSimple(homeFilters[2], { id: 'eth', label: 'ETH', enabled: true }),
        normalizeSimple(homeFilters[3], { id: 'bsc', label: 'BSC', enabled: true }),
      ],
      routeToggles: {
        market: routeToggles.market !== false,
        newTokens: routeToggles.newTokens !== false,
        bot: routeToggles.bot !== false,
        swap: routeToggles.swap !== false,
        wallet: routeToggles.wallet !== false,
        profile: routeToggles.profile !== false,
      },
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
