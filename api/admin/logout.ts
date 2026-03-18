import { clearAdminCookie } from '../_auth.js'

export default async function handler(req: any, res: any) {
  clearAdminCookie(res)
  res.status(200).json({ ok: true })
}

