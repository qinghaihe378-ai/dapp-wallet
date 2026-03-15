#!/usr/bin/env node
/**
 * 测试 Base 链购买 0.1 ETH 的 0xb695559b26bb2c9703ef1935c37aeae9526bab07
 * 运行: node scripts/test-base-buy.mjs
 * 或: VITE_UNISWAP_API_KEY=xxx node scripts/test-base-buy.mjs
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
try {
  const envPath = resolve(process.cwd(), '.env')
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch (_) {}

const TOKEN_OUT = '0xb695559b26bb2c9703ef1935c37aeae9526bab07'
const AMOUNT_WEI = BigInt('100000000000000000') // 0.1 ETH
const SWAPPER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // 示例地址
const API_KEY = process.env.UNISWAP_API_KEY || process.env.VITE_UNISWAP_API_KEY

async function main() {
  console.log('=== Base 买 0.1 ETH 的', TOKEN_OUT, '===')
  console.log('API Key:', API_KEY ? `${API_KEY.slice(0, 8)}...` : '(未配置)')

  if (!API_KEY) {
    console.error('请配置 .env 中的 UNISWAP_API_KEY 或 VITE_UNISWAP_API_KEY')
    process.exit(1)
  }

  const body = {
    type: 'EXACT_INPUT',
    amount: AMOUNT_WEI.toString(),
    tokenInChainId: 8453,
    tokenOutChainId: 8453,
    tokenIn: '0x0000000000000000000000000000000000000000',
    tokenOut: TOKEN_OUT,
    swapper: SWAPPER,
    autoSlippage: 'DEFAULT',
    routingPreference: 'BEST_PRICE',
    protocols: ['V4', 'V3', 'V2'],
    hooksOptions: 'V4_HOOKS_INCLUSIVE',
    generatePermitAsTransaction: false,
    spreadOptimization: 'EXECUTION',
    urgency: 'urgent',
    permitAmount: 'FULL',
  }

  const variants = [
    { name: 'V4+V3+V2', protocols: ['V4', 'V3', 'V2'], hooksOptions: 'V4_HOOKS_INCLUSIVE' },
    { name: '仅 V4', protocols: ['V4'], hooksOptions: 'V4_HOOKS_INCLUSIVE' },
    { name: 'V4 hooks only', protocols: ['V4'], hooksOptions: 'V4_HOOKS_ONLY' },
    { name: 'V4 no hooks', protocols: ['V4'], hooksOptions: 'V4_NO_HOOKS' },
    { name: '不限制 protocols', protocols: undefined, hooksOptions: undefined },
  ]

  for (const v of variants) {
    const b = { ...body }
    if (v.protocols) b.protocols = v.protocols
    else delete b.protocols
    if (v.hooksOptions) b.hooksOptions = v.hooksOptions
    else delete b.hooksOptions

    console.log('\n--- 尝试:', v.name, '---')

    try {
      const res = await fetch('https://trade-api.gateway.uniswap.org/v1/quote', {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-universal-router-version': '2.0',
          'x-permit2-disabled': 'true',
        },
        body: JSON.stringify(b),
      })

      console.log('HTTP 状态:', res.status, res.statusText)

      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        console.log('响应体 (非 JSON):', text.slice(0, 500))
        continue
      }

      if (!res.ok) {
        console.log('API 错误:', data.detail || data.errorCode || JSON.stringify(data))
        continue
      }

      console.log('✓ 报价成功! routing:', data.routing, 'output:', data.quote?.output?.amount)
      process.exit(0)
    } catch (e) {
      console.log('请求失败:', e.message)
    }
  }
  console.log('\n所有变体均无报价')
}

main()
