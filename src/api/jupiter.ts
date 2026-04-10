/** 规范化合约地址输入：可带或不带 0x，须为 40 位十六进制 */
export function parseEvmAddressInput(s: string): string | null {
  const t = s.trim().replace(/\s/g, '')
  if (!t) return null
  const hex = t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t
  if (!/^[a-fA-F0-9]{40}$/.test(hex)) return null
  return `0x${hex.toLowerCase()}`
}

/** EVM 合约地址校验（接受带或不带 0x） */
export function isEvmAddress(s: string): boolean {
  return parseEvmAddressInput(s) !== null
}
