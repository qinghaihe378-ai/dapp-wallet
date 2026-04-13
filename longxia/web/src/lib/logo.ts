export function normalizeLogoUrl(input: string): string {
  const v = (input ?? "").trim()
  if (!v) return ""
  if (v.startsWith("data:")) return ""
  if (v.startsWith("ipfs://")) {
    const rest = v.slice("ipfs://".length)
    const path = rest.startsWith("ipfs/") ? rest.slice("ipfs/".length) : rest
    return `https://ipfs.io/ipfs/${path}`
  }
  return v
}

export function logoFallbackText(symbol?: string, name?: string) {
  const s = (symbol ?? "").trim()
  if (s) return s.slice(0, 1).toUpperCase()
  const n = (name ?? "").trim()
  if (n) return n.slice(0, 1).toUpperCase()
  return "?"
}

export function logoFallbackClass(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const variants = [
    "bg-gradient-to-br from-sky-500/70 to-indigo-500/70",
    "bg-gradient-to-br from-emerald-500/70 to-teal-500/70",
    "bg-gradient-to-br from-fuchsia-500/70 to-rose-500/70",
    "bg-gradient-to-br from-amber-500/70 to-orange-500/70",
    "bg-gradient-to-br from-violet-500/70 to-purple-500/70",
    "bg-gradient-to-br from-cyan-500/70 to-sky-500/70"
  ]
  return variants[h % variants.length]
}
