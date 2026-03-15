/** PumpDev API - Pump.fun 内盘备用路由 */

const PUMPDEV_TRADE_URL = 'https://pumpdev.io/api/trade-local'

export const SOL_MINT = 'So11111111111111111111111111111111111111112'

export interface PumpDevTradeParams {
  publicKey: string
  action: 'buy' | 'sell'
  mint: string
  amount: number | string
  denominatedInSol: boolean
  slippage: number
  priorityFee?: number
}

export interface PumpDevTradeResult {
  success: true
  serializedTx: string
}

export interface PumpDevTradeError {
  success: false
  error?: string
}

/** 获取 PumpDev 交易（客户端签名），返回 base64 序列化交易 */
export async function getPumpDevTransaction(
  params: PumpDevTradeParams,
): Promise<PumpDevTradeResult | PumpDevTradeError> {
  try {
    const body = {
      publicKey: params.publicKey,
      action: params.action,
      mint: params.mint,
      amount: params.amount,
      denominatedInSol: String(params.denominatedInSol),
      slippage: params.slippage,
      ...(params.priorityFee != null && { priorityFee: params.priorityFee }),
    }
    const res = await fetch(PUMPDEV_TRADE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) {
      const text = await res.text()
      let err: unknown
      try {
        err = JSON.parse(text)
      } catch {
        err = { message: text || res.statusText }
      }
      return { success: false, error: (err as { error?: string; message?: string })?.error ?? (err as { message?: string })?.message ?? res.statusText }
    }
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { transaction?: string; serializedTransaction?: string }
      const tx = data?.transaction ?? data?.serializedTransaction
      if (typeof tx !== 'string') return { success: false, error: 'Invalid response' }
      return { success: true, serializedTx: tx }
    }
    const buf = await res.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    return { success: true, serializedTx: base64 }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
