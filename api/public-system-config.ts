import { getJson } from './_redis.js'

const SYSTEM_CONFIG_KEY = 'clawdex:systemConfig'

export default async function handler(_req: any, res: any) {
  try {
    const config = await getJson<any>(SYSTEM_CONFIG_KEY)
    if (!config) {
      res.status(200).json({ ok: true, config: null })
      return
    }
    const safeConfig = {
      ...config,
      apiKeys: undefined,
    }
    res.status(200).json({ ok: true, config: safeConfig })
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
