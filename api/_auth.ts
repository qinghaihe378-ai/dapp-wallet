import { createHmac, timingSafeEqual } from 'crypto'

const COOKIE_NAME = 'clawdex_admin'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

function base64UrlEncode(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeToBuffer(s: string) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

function sign(payloadB64u: string, secret: string) {
  const h = createHmac('sha256', secret)
  h.update(payloadB64u)
  return base64UrlEncode(h.digest())
}

export function getCookieName() {
  return COOKIE_NAME
}

export function parseCookies(req: any): Record<string, string> {
  const header = String(req?.headers?.cookie ?? '')
  const out: Record<string, string> = {}
  if (!header) return out
  const parts = header.split(';')
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=')
    if (!k) continue
    out[k] = decodeURIComponent(rest.join('=') || '')
  }
  return out
}

export function makeAdminToken(nowMs = Date.now()) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) throw new Error('ADMIN_SECRET 未配置')
  const payload = { iat: Math.floor(nowMs / 1000) }
  const payloadB64u = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(payloadB64u, secret)
  return `${payloadB64u}.${sig}`
}

export function verifyAdminToken(token: string, nowMs = Date.now()): boolean {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  const [payloadB64u, sig] = token.split('.')
  if (!payloadB64u || !sig) return false
  const expected = sign(payloadB64u, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  if (!timingSafeEqual(a, b)) return false
  try {
    const payload = JSON.parse(base64UrlDecodeToBuffer(payloadB64u).toString('utf8')) as { iat?: number }
    const iat = typeof payload?.iat === 'number' ? payload.iat : 0
    if (!iat) return false
    const age = Math.floor(nowMs / 1000) - iat
    if (age < 0 || age > MAX_AGE_SECONDS) return false
    return true
  } catch {
    return false
  }
}

export function requireAdmin(req: any) {
  const cookies = parseCookies(req)
  const token = cookies[COOKIE_NAME]
  if (!token || !verifyAdminToken(token)) {
    const err = new Error('Unauthorized')
    ;(err as any).statusCode = 401
    throw err
  }
}

export function setAdminCookie(res: any, token: string) {
  const secure = process.env.NODE_ENV === 'production'
  const cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ')
  res.setHeader('Set-Cookie', cookie)
}

export function clearAdminCookie(res: any) {
  const secure = process.env.NODE_ENV === 'production'
  const cookie = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ')
  res.setHeader('Set-Cookie', cookie)
}

