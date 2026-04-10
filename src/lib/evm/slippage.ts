/** 在用户设定滑点外再放宽的最小输出（bps），减轻链上确认延迟与池子波动导致的 STF 回退 */
const EXTRA_MIN_OUT_SLIPPAGE_BPS = 50

export function minimumOutFromQuoted(quotedOutWei: bigint, slippagePercent: number): bigint {
  const userBps = Math.round(slippagePercent * 100)
  const totalBps = Math.min(userBps + EXTRA_MIN_OUT_SLIPPAGE_BPS, 9950)
  return quotedOutWei - (quotedOutWei * BigInt(totalBps)) / 10000n
}
