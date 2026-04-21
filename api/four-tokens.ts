import { fetchFourMemeTokenSnapshot } from './_fourMeme.js'

export default async function handler(req: any, res: any) {
  try {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    const raw = String(req.query?.addresses ?? '')
    const addresses = raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter((v) => /^0x[a-f0-9]{40}$/.test(v))
      .slice(0, 12)

    if (addresses.length === 0) {
      res.status(200).json({ snapshots: {} })
      return
    }

    const entries = await Promise.all(
      addresses.map(async (address) => [address, await fetchFourMemeTokenSnapshot(address)] as const),
    )

    const snapshots = Object.fromEntries(entries.filter(([, snapshot]) => snapshot))
    res.status(200).json({ snapshots })
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'four tokens fetch failed' })
  }
}
