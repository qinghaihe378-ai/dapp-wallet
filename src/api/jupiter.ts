/** EVM 合约地址校验（与 0x 前缀 40 位十六进制） */
export function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim())
}
