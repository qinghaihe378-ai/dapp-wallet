import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js'
import { buildRaydiumSwapTransaction } from '../../api/raydium'
import { getJupiterHeaders } from '../../api/jupiterApi'
import { getJupiterQuote } from './quote'
import { NETWORK_CONFIG } from '../walletConfig'
import type { SolanaLiveQuote } from './quote'

const JUPITER_SWAP_URLS = [
  'https://api.jup.ag/swap/v1/swap',
  'https://quote-api.jup.ag/v6/swap',
]
const RPC_ENDPOINT = NETWORK_CONFIG.solana.rpcUrls[0]

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function executeJupiterSwap(
  keypair: Keypair,
  quote: SolanaLiveQuote,
  userPublicKey: string,
): Promise<{ swapHash: string }> {
  let txBuf: Uint8Array | undefined
  if (quote.pumpDevTx) {
    txBuf = base64ToUint8Array(quote.pumpDevTx)
  } else if (quote.raydiumQuote) {
    const isInputSol = quote.tokenIn.isNative
    const isOutputSol = quote.tokenOut.isNative
    let txB64 = await buildRaydiumSwapTransaction(
      quote.raydiumQuote,
      userPublicKey,
      isInputSol,
      isOutputSol,
    )
    if (!txB64) {
      const d = quote.raydiumQuote.data
      const amountInRaw = d?.inputAmount ?? '0'
      const slippageBps = d?.slippageBps ?? 200
      const jupiterQuote = await getJupiterQuote(
        quote.tokenIn,
        quote.tokenOut,
        amountInRaw,
        slippageBps,
      )
      if (jupiterQuote?.rawQuote) {
        const swapBody = {
          quoteResponse: jupiterQuote.rawQuote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto' as const,
        }
        for (const url of JUPITER_SWAP_URLS) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getJupiterHeaders() },
            body: JSON.stringify(swapBody),
          })
          if (res.ok) {
            const json = (await res.json()) as { swapTransaction?: string }
            const swapTx = json?.swapTransaction
            if (swapTx) {
              txBuf = base64ToUint8Array(swapTx)
              break
            }
          }
        }
      }
    } else {
      txBuf = base64ToUint8Array(txB64)
    }
    if (!txBuf) throw new Error('Raydium 交易构建失败，Jupiter 备用也失败，请稍后重试')
  } else if (quote.rawQuote) {
    const swapBody = {
      quoteResponse: quote.rawQuote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto' as const,
    }
    let swapTx: string | null = null
    let lastErr = ''
    for (const url of JUPITER_SWAP_URLS) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getJupiterHeaders() },
        body: JSON.stringify(swapBody),
      })
      if (res.ok) {
        const json = (await res.json()) as { swapTransaction?: string }
        swapTx = json?.swapTransaction ?? null
        if (swapTx) break
      } else {
        lastErr = await res.text()
      }
    }
    if (!swapTx) throw new Error(lastErr || 'Jupiter 交易构建失败，请重试')
    txBuf = base64ToUint8Array(swapTx)
  } else {
    throw new Error('无效报价')
  }

  if (!txBuf) throw new Error('无效报价')
  const tx = VersionedTransaction.deserialize(txBuf)
  tx.sign([keypair])

  const conn = new Connection(RPC_ENDPOINT)
  const sig = await conn.sendTransaction(tx, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })

  return { swapHash: sig }
}

export function getSolanaKeypairFromStorage(): Keypair | null {
  const STORAGE_KEY = 'internal_solana_secret_v1'
  const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (!saved) return null
  try {
    const arr: number[] = JSON.parse(saved)
    const secret = Uint8Array.from(arr)
    return Keypair.fromSecretKey(secret)
  } catch {
    return null
  }
}
