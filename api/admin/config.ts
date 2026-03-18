import { requireAdmin } from '../_auth.js'
import { getJson, pageConfigKey, setJson } from '../_redis.js'

const PAGE_ID_REG = /^[a-zA-Z0-9_-]{1,40}$/

export default async function handler(req: any, res: any) {
  try {
    requireAdmin(req)

    const method = String(req?.method ?? 'GET').toUpperCase()
    const page = String(req?.query?.page ?? '').trim()
    if (!page || !PAGE_ID_REG.test(page)) {
      res.status(400).json({ ok: false, message: 'invalid page' })
      return
    }
    const key = pageConfigKey(page)

    if (method === 'GET') {
      const cfg = await getJson<any>(key)
      res.status(200).json({ ok: true, page, config: cfg })
      return
    }

    if (method === 'PUT' || method === 'POST') {
      const body = typeof req?.body === 'string' ? JSON.parse(req.body) : (req?.body ?? {})
      const config = body?.config
      if (config == null || typeof config !== 'object') {
        res.status(400).json({ ok: false, message: 'missing config' })
        return
      }
      const payload = { ...config, updatedAt: Date.now() }
      await setJson(key, payload)
      res.status(200).json({ ok: true, page, config: payload })
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

