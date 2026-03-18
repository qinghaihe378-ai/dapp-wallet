import { makeAdminToken, setAdminCookie } from '../_auth.js'

export default async function handler(req: any, res: any) {
  try {
    if (String(req?.method ?? 'GET').toUpperCase() !== 'POST') {
      res.status(405).json({ ok: false, message: 'Method Not Allowed' })
      return
    }

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      res.status(500).json({ ok: false, message: 'ADMIN_PASSWORD 未配置' })
      return
    }

    const body = typeof req?.body === 'string' ? JSON.parse(req.body) : (req?.body ?? {})
    const password = String(body?.password ?? '')
    if (!password || password !== adminPassword) {
      res.status(401).json({ ok: false, message: '密码错误' })
      return
    }

    const token = makeAdminToken()
    setAdminCookie(res, token)
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

