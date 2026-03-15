/**
 * Raydium Trade API - Solana 直连报价与交易
 * 文档: https://docs.raydium.io/raydium/build/developer-guides/overview
 */

const RAYDIUM_HOST = 'https://transaction-v1.raydium.io'
const QUOTE_TIMEOUT_MS = 6_000

export interface RaydiumQuoteResponse {
  id?: string
  success: boolean
  data?: {
    swapType: string
    inputMint: string
    inputAmount: string
    outputMint: string
    outputAmount: string
    otherAmountThreshold: string
    slippageBps: number
    priceImpactPct: number
    routePlan?: Array<{
      poolId: string
      inputMint: string
      outputMint: string
    }>
  }
}

export interface RaydiumSwapInput {
  fromToken: { mint: string; decimals: number; isNative: boolean }
  toToken: { mint: string; decimals: number; isNative: boolean }
  amountInRaw: string
  slippageBps: number
  userPublicKey: string
}

/** 获取 Raydium 报价 */
export async function fetchRaydiumQuote(input: RaydiumSwapInput): Promise<RaydiumQuoteResponse | null> {
  const params = new URLSearchParams({
    inputMint: input.fromToken.mint,
    outputMint: input.toToken.mint,
    amount: input.amountInRaw,
    slippageBps: String(input.slippageBps),
    txVersion: 'V0',
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)
  try {
    const res = await fetch(`${RAYDIUM_HOST}/compute/swap-base-in?${params}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const data = (await res.json()) as RaydiumQuoteResponse
    return data?.success && data?.data ? data : null
  } catch {
    clearTimeout(timeout)
    return null
  }
}

/** 用 Raydium 报价构建可签名交易 */
export async function buildRaydiumSwapTransaction(
  quoteResponse: RaydiumQuoteResponse,
  userPublicKey: string,
  isInputSol: boolean,
  isOutputSol: boolean,
): Promise<string | null> {
  if (!quoteResponse?.success || !quoteResponse?.data) return null

  const body = {
    swapResponse: quoteResponse,
    wallet: userPublicKey,
    txVersion: 'V0',
    wrapSol: isInputSol,
    unwrapSol: isOutputSol,
  }

  const res = await fetch(`${RAYDIUM_HOST}/transaction/swap-base-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { success?: boolean; data?: Array<{ transaction: string }> }
  const tx = json?.data?.[0]?.transaction
  return tx ?? null
}
