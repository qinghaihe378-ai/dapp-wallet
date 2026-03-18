import { getJson, pageConfigKey } from './_redis.js'

const PAGE_ID_REG = /^[a-zA-Z0-9_-]{1,40}$/

export default async function handler(req: any, res: any) {
  try {
    const page = String(req?.query?.page ?? '').trim()
    if (!page || !PAGE_ID_REG.test(page)) {
      res.status(400).json({ ok: false, message: 'invalid page' })
      return
    }
    const cfg = await getJson<any>(pageConfigKey(page))
    res.status(200).json({ ok: true, page, config: cfg })
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

