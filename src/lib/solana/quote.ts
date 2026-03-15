import { fetchRaydiumQuote, type RaydiumQuoteResponse } from '../../api/raydium'
import { getPumpDevTransaction, SOL_MINT as PUMPDEV_SOL_MINT } from '../../api/pumpdev'
import { getJupiterHeaders } from '../../api/jupiterApi'
import { USDC_MINT, USDT_MINT, type SolanaToken } from './tokens'

const KNOWN_STABLECOINS = new Set([USDT_MINT, USDC_MINT])
const JUPITER_QUOTE_URLS = [
  'https://api.jup.ag/swap/v1/quote',
  'https://quote-api.jup.ag/v6/quote',
]
const QUOTE_TTL_MS = 20_000
const QUOTE_TIMEOUT_MS = 10_000

export interface JupiterQuoteResponse {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  priceImpactPct: string
  routePlan: Array<{
    swapInfo: { ammKey: string; label: string }
    percent: number
  }>
  contextSlot?: number
  timeTaken?: number
}

export interface SolanaLiveQuote {
  protocolLabel: string
  routeLabel: string
  estimatedOut: string
  minimumReceived: string
  priceImpactPct: number
  routePlan: JupiterQuoteResponse['routePlan']
  routeSymbols: string[]
  quoteMode: 'v2' | 'v3'
  tokenIn: SolanaToken
  tokenOut: SolanaToken
  rawQuote?: JupiterQuoteResponse
  expiresAt: number
  /** PumpDev 备用：序列化交易 base64 */
  pumpDevTx?: string
  /** Raydium 报价：用于构建交易 */
  raydiumQuote?: RaydiumQuoteResponse
}

/** Jupiter 自动选择最优路由：不限制 DEX，聚合全市场报价取最佳 */
export async function getJupiterQuote(
  fromToken: SolanaToken,
  toToken: SolanaToken,
  amountInRaw: string,
  slippageBps: number,
): Promise<SolanaLiveQuote> {
  const baseParams: Record<string, string> = {
    inputMint: fromToken.mint,
    outputMint: toToken.mint,
    amount: amountInRaw,
    slippageBps: String(slippageBps),
    onlyDirectRoutes: 'false',
  }
  const v1Extra = { restrictIntermediateTokens: 'true', instructionVersion: 'V2' }

  let lastErr: Error | null = null
  for (const baseUrl of JUPITER_QUOTE_URLS) {
    const params = new URLSearchParams(
      baseUrl.includes('/v1/') ? { ...baseParams, ...v1Extra } : baseParams,
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)
    try {
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: getJupiterHeaders(),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) {
        lastErr = new Error(await res.text().catch(() => res.statusText) || `Jupiter ${res.status}`)
        continue
      }
      const data = (await res.json()) as JupiterQuoteResponse
      if (!data?.outAmount) {
        lastErr = new Error('Jupiter 返回无效报价')
        continue
      }
      const routeLabel = data.routePlan?.length
        ? data.routePlan.map((r) => r.swapInfo.label).join(' → ')
        : 'Jupiter'
      return {
        protocolLabel: routeLabel || 'Jupiter',
        routeLabel: `${fromToken.symbol} > ${toToken.symbol} · ${routeLabel || 'Jupiter'}`,
        estimatedOut: formatSolanaAmount(data.outAmount, toToken.decimals),
        minimumReceived: formatSolanaAmount(data.otherAmountThreshold ?? data.outAmount, toToken.decimals),
        priceImpactPct: parseFloat(data.priceImpactPct ?? '0') || 0,
        routePlan: data.routePlan ?? [],
        routeSymbols: [fromToken.symbol, toToken.symbol],
        quoteMode: 'v3',
        tokenIn: fromToken,
        tokenOut: toToken,
        rawQuote: data,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      continue
    }
  }
  throw lastErr ?? new Error('Jupiter 报价失败')
}

/** 判断是否为 SOL <-> 单一代币（PumpDev 仅支持此场景） */
function isSolToSingleToken(from: SolanaToken, to: SolanaToken): boolean {
  const solMint = PUMPDEV_SOL_MINT
  return (from.mint === solMint && to.mint !== solMint) || (from.mint !== solMint && to.mint === solMint)
}

function toRaydiumLiveQuote(
  res: RaydiumQuoteResponse,
  fromToken: SolanaToken,
  toToken: SolanaToken,
): SolanaLiveQuote {
  const d = res.data!
  const routeLabel = d.routePlan?.length ? 'Raydium' : 'Raydium'
  return {
    protocolLabel: 'Raydium',
    routeLabel: `${fromToken.symbol} > ${toToken.symbol} · ${routeLabel}`,
    estimatedOut: formatSolanaAmount(d.outputAmount, toToken.decimals),
    minimumReceived: formatSolanaAmount(d.otherAmountThreshold, toToken.decimals),
    priceImpactPct: d.priceImpactPct ?? 0,
    routePlan: [],
    routeSymbols: [fromToken.symbol, toToken.symbol],
    quoteMode: 'v3',
    tokenIn: fromToken,
    tokenOut: toToken,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    raydiumQuote: res,
  }
}

/** 并行获取 Jupiter + Raydium 报价，取输出最多者；都失败时尝试 PumpDev（仅 SOL <-> Pump） */
export async function getSolanaQuoteWithFallback(
  fromToken: SolanaToken,
  toToken: SolanaToken,
  amountInRaw: string,
  slippageBps: number,
  userPublicKey: string,
): Promise<SolanaLiveQuote> {
  const raydiumInput = {
    fromToken: { mint: fromToken.mint, decimals: fromToken.decimals, isNative: fromToken.isNative },
    toToken: { mint: toToken.mint, decimals: toToken.decimals, isNative: toToken.isNative },
    amountInRaw,
    slippageBps,
    userPublicKey,
  }

  const [jupiterQuote, raydiumQuote] = await Promise.all([
    getJupiterQuote(fromToken, toToken, amountInRaw, slippageBps).catch(() => null),
    fetchRaydiumQuote(raydiumInput).then((r) => (r ? toRaydiumLiveQuote(r, fromToken, toToken) : null)),
  ])

  const candidates: SolanaLiveQuote[] = [jupiterQuote, raydiumQuote].filter(Boolean) as SolanaLiveQuote[]
  if (candidates.length > 0) {
    const outAmount = (q: SolanaLiveQuote) => {
      const n = parseFloat(q.estimatedOut)
      return Number.isFinite(n) ? n : 0
    }
    const best = candidates.reduce((a, q) => (outAmount(q) > outAmount(a) ? q : a), candidates[0])
    const preferJupiter = KNOWN_STABLECOINS.has(fromToken.mint) || KNOWN_STABLECOINS.has(toToken.mint)
    if (preferJupiter && jupiterQuote && outAmount(jupiterQuote) > 0) return jupiterQuote
    return best
  }

  if (!isSolToSingleToken(fromToken, toToken)) {
    throw new Error('Jupiter 与 Raydium 均无报价，请检查代币或稍后重试')
  }
  const isBuy = fromToken.mint === PUMPDEV_SOL_MINT
  const pumpMint = isBuy ? toToken.mint : fromToken.mint
  if (KNOWN_STABLECOINS.has(pumpMint)) {
    throw new Error('Jupiter 与 Raydium 均无报价。USDT/USDC 等稳定币请稍后重试；若持续失败可配置 Jupiter API Key')
  }
  const amountNum = Number(amountInRaw) / 10 ** fromToken.decimals
  if (amountNum <= 0) throw new Error('输入数量无效')
  const result = await getPumpDevTransaction({
    publicKey: userPublicKey,
    action: isBuy ? 'buy' : 'sell',
    mint: pumpMint,
    amount: amountNum,
    denominatedInSol: isBuy,
    slippage: Math.max(1, slippageBps / 100),
  })
  if (!result.success) {
    throw new Error(result.error ?? 'PumpDev 备用路由失败')
  }
  return {
    protocolLabel: 'PumpDev',
    routeLabel: `${fromToken.symbol} > ${toToken.symbol} · PumpDev`,
    estimatedOut: '—',
    minimumReceived: '—',
    priceImpactPct: 0,
    routePlan: [],
    routeSymbols: [fromToken.symbol, toToken.symbol],
    quoteMode: 'v3',
    tokenIn: fromToken,
    tokenOut: toToken,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    pumpDevTx: result.serializedTx,
  }
}

function formatSolanaAmount(raw: string, decimals: number): string {
  const n = BigInt(raw)
  const divisor = BigInt(10 ** decimals)
  const whole = n / divisor
  const frac = n % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, decimals)
  return fracStr ? `${whole}.${fracStr.replace(/0+$/, '')}` : String(whole)
}
