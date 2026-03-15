#!/usr/bin/env node
/**
 * 测试 GeckoTerminal 池子发现 + 链上报价
 * 运行: node scripts/test-gecko-quote.mjs
 */

import { ethers } from 'ethers'

const TOKEN = '0xb695559b26bb2c9703ef1935c37aeae9526bab07'
const AMOUNT = '0.1'
const RPC = 'https://mainnet.base.org'

async function main() {
  console.log('=== 测试 Base 0.1 ETH ->', TOKEN, '===')

  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/base/tokens/${TOKEN.toLowerCase()}/pools?page=1`)
  const json = await res.json()
  const pools = json.data ?? []

  console.log('GeckoTerminal 池子数:', pools.length)
  const v3Pools = pools.filter((p) => (p.relationships?.dex?.data?.id ?? '').includes('uniswap-v3'))
  console.log('Uniswap V3 池子:', v3Pools.length)

  const provider = new ethers.JsonRpcProvider(RPC)
  const quoterAddr = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'
  const quoterAbi = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']

  const weth = '0x4200000000000000000000000000000000000006'
  const amountWei = ethers.parseUnits(AMOUNT, 18)

  const quoter = new ethers.Contract(quoterAddr, quoterAbi, provider)

  for (const pool of v3Pools.slice(0, 3)) {
    const name = pool.attributes?.name ?? ''
    const feeMatch = name.match(/(\d+\.?\d*)\s*%/)
    const fee = feeMatch ? Math.round(parseFloat(feeMatch[1]) * 10000) : 3000
    try {
      const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: weth,
        tokenOut: ethers.getAddress(TOKEN),
        amountIn: amountWei,
        fee,
        sqrtPriceLimitX96: 0,
      })
      console.log(name, 'fee', fee, '-> amountOut:', amountOut.toString())
    } catch (e) {
      console.log(name, 'fee', fee, '-> 失败:', e.message?.slice(0, 50))
    }
  }
}

main().catch(console.error)
