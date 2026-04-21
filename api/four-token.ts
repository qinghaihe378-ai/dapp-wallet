import { fetchFourMemeTokenSnapshot } from './_fourMeme.js'

export default async function handler(req: any, res: any) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    const address = String(req.query?.address ?? '').trim().toLowerCase()
    if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
      res.status(400).json({ error: 'invalid address' })
      return
    }
    const snapshot = await fetchFourMemeTokenSnapshot(address)
    res.status(200).json({ snapshot })
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'four token fetch failed' })
  }
}
