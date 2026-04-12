import { formatUnits } from "viem"

export function formatBn(bi: bigint | undefined, decimals = 18, maxFrac = 6): string {
  if (bi === undefined) return "-"
  const s = formatUnits(bi, decimals)
  const [a, b] = s.split(".")
  if (!b) return a
  return `${a}.${b.slice(0, maxFrac)}`.replace(/\.$/, "")
}

