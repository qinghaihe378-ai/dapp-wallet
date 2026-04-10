import { ethers } from 'ethers'
import { fetchUniswapSwapTransaction } from '../../api/uniswapTrade'
import { ensureAllowance } from './allowance'
import { V2_ROUTER_ABI, V3_ROUTER_ABI } from './abis'
import { encodeV3Path } from './format'
import type { LiveQuote } from './quote'

export interface SwapExecutionResult {
  approveHash: string | null
  swapHash: string
}

export type SwapExecutionStage = 'approving' | 'swapping'

export interface SwapExecutionCallbacks {
  onStageChange?: (stage: SwapExecutionStage) => void
  onApproveBroadcast?: (hash: string) => void
}

const EXECUTION_DEADLINE_SECONDS = 60 * 15

function buildRelaxedMinOuts(baseMinOut: bigint): bigint[] {
  // 对税费代币，报价通常未计入 transfer tax，按阶梯放宽 minOut 提高成交概率
  const q70 = (baseMinOut * 70n) / 100n
  const q40 = (baseMinOut * 40n) / 100n
  return Array.from(new Set([baseMinOut, q70, q40, 0n]))
}

export async function executeQuotedSwap(
  signer: ethers.Signer,
  recipient: string,
  quote: LiveQuote,
  callbacks?: SwapExecutionCallbacks,
): Promise<SwapExecutionResult> {
  const deadline = Math.floor(Date.now() / 1000) + EXECUTION_DEADLINE_SECONDS

  if (quote.quoteMode === 'api') {
    return await executeUniswapApiSwap(signer, recipient, quote, callbacks)
  }

  if (quote.quoteMode === 'v2') {
    return await executeV2Swap(signer, recipient, quote, deadline, callbacks)
  }

  return await executeV3Swap(signer, recipient, quote, deadline, callbacks)
}

async function executeUniswapApiSwap(
  signer: ethers.Signer,
  _recipient: string,
  quote: LiveQuote,
  callbacks?: SwapExecutionCallbacks,
): Promise<SwapExecutionResult> {
  if (!quote._api) {
    throw new Error('Uniswap API 报价数据缺失')
  }

  const apiQuote = {
    ...quote,
    _api: quote._api,
  }

  const swapTx = await fetchUniswapSwapTransaction(apiQuote)
  const tokenIn = quote.tokenIn
  let approveHash: string | null = null

  if (!tokenIn.isNative) {
    callbacks?.onStageChange?.('approving')
    approveHash = await ensureAllowance(
      signer,
      tokenIn,
      swapTx.to,
      quote.amountInWei,
      callbacks?.onApproveBroadcast,
    )
  }

  callbacks?.onStageChange?.('swapping')
  const tx = await signer.sendTransaction({
    to: swapTx.to,
    from: swapTx.from,
    data: swapTx.data,
    value: BigInt(swapTx.value),
    chainId: swapTx.chainId,
    gasLimit: swapTx.gasLimit ? BigInt(swapTx.gasLimit) : undefined,
  })

  return {
    approveHash,
    swapHash: tx.hash,
  }
}

async function executeV2Swap(
  signer: ethers.Signer,
  recipient: string,
  quote: LiveQuote,
  deadline: number,
  callbacks?: SwapExecutionCallbacks,
) {
  const router = new ethers.Contract(quote.routerAddress, V2_ROUTER_ABI, signer)
  const tokenIn = quote.tokenIn
  const tokenOut = quote.tokenOut
  let approveHash: string | null = null

  if (!tokenIn.isNative) {
    callbacks?.onStageChange?.('approving')
    approveHash = await ensureAllowance(signer, tokenIn, quote.routerAddress, quote.amountInWei, callbacks?.onApproveBroadcast)
  }

  let tx: ethers.TransactionResponse | null = null
  callbacks?.onStageChange?.('swapping')
  if (tokenIn.isNative) {
    try {
      tx = await router.swapExactETHForTokens(
        quote.minimumAmountOutWei,
        quote.pathAddresses,
        recipient,
        deadline,
        { value: quote.amountInWei },
      )
    } catch {
      let lastError: unknown = null
      const minOuts = buildRelaxedMinOuts(quote.minimumAmountOutWei)
      for (const minOut of minOuts) {
        try {
          tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
            minOut,
            quote.pathAddresses,
            recipient,
            deadline,
            { value: quote.amountInWei },
          )
          lastError = null
          break
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
    }
  } else if (tokenOut.isNative) {
    try {
      tx = await router.swapExactTokensForETH(
        quote.amountInWei,
        quote.minimumAmountOutWei,
        quote.pathAddresses,
        recipient,
        deadline,
      )
    } catch {
      let lastError: unknown = null
      const minOuts = buildRelaxedMinOuts(quote.minimumAmountOutWei)
      for (const minOut of minOuts) {
        try {
          tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            quote.amountInWei,
            minOut,
            quote.pathAddresses,
            recipient,
            deadline,
          )
          lastError = null
          break
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
    }
  } else {
    try {
      tx = await router.swapExactTokensForTokens(
        quote.amountInWei,
        quote.minimumAmountOutWei,
        quote.pathAddresses,
        recipient,
        deadline,
      )
    } catch {
      let lastError: unknown = null
      const minOuts = buildRelaxedMinOuts(quote.minimumAmountOutWei)
      for (const minOut of minOuts) {
        try {
          tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            quote.amountInWei,
            minOut,
            quote.pathAddresses,
            recipient,
            deadline,
          )
          lastError = null
          break
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
    }
  }

  if (!tx) {
    throw new Error('V2 兑换失败：未能生成交易')
  }

  return {
    approveHash,
    swapHash: tx.hash,
  }
}

async function executeV3Swap(
  signer: ethers.Signer,
  recipient: string,
  quote: LiveQuote,
  deadline: number,
  callbacks?: SwapExecutionCallbacks,
) {
  const router = new ethers.Contract(quote.routerAddress, V3_ROUTER_ABI, signer)
  const tokenIn = quote.tokenIn
  const tokenOut = quote.tokenOut
  let approveHash: string | null = null

  if (!tokenIn.isNative) {
    callbacks?.onStageChange?.('approving')
    approveHash = await ensureAllowance(signer, tokenIn, quote.routerAddress, quote.amountInWei, callbacks?.onApproveBroadcast)
  }

  const path = encodeV3Path(quote.pathAddresses, quote.pathFees)
  const recipientForSwap = tokenOut.isNative ? quote.routerAddress : recipient
  const exactInputData = router.interface.encodeFunctionData('exactInput', [[
    path,
    recipientForSwap,
    BigInt(deadline),
    quote.amountInWei,
    quote.minimumAmountOutWei,
  ]])

  let tx: ethers.TransactionResponse
  callbacks?.onStageChange?.('swapping')
  if (tokenOut.isNative) {
    const unwrapData = router.interface.encodeFunctionData('unwrapWETH9', [
      quote.minimumAmountOutWei,
      recipient,
    ])
    tx = await router.multicall([exactInputData, unwrapData], {
      value: tokenIn.isNative ? quote.amountInWei : 0n,
    })
  } else {
    tx = await router.exactInput(
      [
        path,
        recipient,
        BigInt(deadline),
        quote.amountInWei,
        quote.minimumAmountOutWei,
      ],
      {
        value: tokenIn.isNative ? quote.amountInWei : 0n,
      },
    )
  }

  return {
    approveHash,
    swapHash: tx.hash,
  }
}
