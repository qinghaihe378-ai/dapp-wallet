/**
 * Boot 指令解析（站内版）
 * 与 parseBuyMessage 互补：买、卖、帮助、任务、跟单、取消等
 */

import type { BotChain } from '../bot/parseBuyMessage'
import { parseBuyMessage, type ParsedBuyIntent } from '../bot/parseBuyMessage'

export type BootTaskKind = 'limit_buy' | 'limit_sell' | 'tp_sl' | 'snipe' | 'copy_mirror'

export interface ParsedSellIntent {
  chain: BotChain
  amount: string
  /** 卖出的代币符号或地址 */
  sellToken: string
  /** 换成的代币符号 */
  receiveToken: string
}

/** 限价单：到达目标价（USD 计价的大致参考）时执行 */
export interface LimitOrderPayload {
  kind: 'limit_buy' | 'limit_sell'
  chain: BotChain
  amount: string
  payToken: string
  targetToken: string
  /** 目标单价 USD（粗略，用于轮询比较） */
  targetPriceUsd: number
}

export interface TpSlPayload {
  chain: BotChain
  tokenSymbolOrAddr: string
  /** 相对入场价百分比，正数 */
  takeProfitPercent?: number
  stopLossPercent?: number
  /** 卖出比例 0-100 */
  sellPercent: number
}

export interface SnipePayload {
  chain: BotChain
  mintOrAddr: string
  maxPayAmount: string
  payToken: string
}

export type BootIntent =
  | { type: 'buy'; intent: ParsedBuyIntent }
  | { type: 'sell'; intent: ParsedSellIntent }
  | { type: 'help' }
  | { type: 'cancel'; taskId: string }
  | { type: 'list_tasks' }
  | { type: 'limit'; payload: LimitOrderPayload }
  | { type: 'tpsl'; payload: TpSlPayload }
  | { type: 'snipe'; payload: SnipePayload }
  | { type: 'copy_add'; address: string }
  | { type: 'copy_remove'; address: string }
  | { type: 'copy_toggle'; enabled: boolean }
  | { type: 'risk_show' }
  | { type: 'unknown'; raw: string }

const CHAIN_ALIASES: Record<string, BotChain> = {
  bsc: 'bsc',
  bnb: 'bsc',
  eth: 'mainnet',
  ethereum: 'mainnet',
  mainnet: 'mainnet',
  base: 'base',
  sol: 'solana',
  solana: 'solana',
}

function normChain(s: string): BotChain | null {
  const k = s.trim().toLowerCase()
  return CHAIN_ALIASES[k] ?? null
}

/** 卖 10 USDT 换 BNB | sell 10 USDT for BNB | bsc 卖 10 USDT 换 BNB */
export function parseSellMessage(text: string): ParsedSellIntent | null {
  const t = text.trim()
  const m = t.match(
    /^(?:(bsc|bnb|eth|ethereum|mainnet|base|sol|solana)\s+)?(?:卖|sell)\s+([\d.]+)\s+(\S+?)\s+(?:换|for)\s+(\S+)\s*$/i,
  )
  if (!m) return null
  const [, chainRaw, amount, sellTok, recvTok] = m
  let chain: BotChain | null = chainRaw ? normChain(chainRaw) : null
  const amountNum = parseFloat(amount)
  if (!Number.isFinite(amountNum) || amountNum <= 0) return null
  if (!chain) {
    const su = sellTok.toUpperCase()
    if (su === 'BNB') chain = 'bsc'
    else if (su === 'SOL') chain = 'solana'
    else chain = 'mainnet'
  }
  return {
    chain,
    amount: amount.trim(),
    sellToken: sellTok.trim(),
    receiveToken: recvTok.trim(),
  }
}

/**
 * 限价买 0.1 BNB 的 USDT 目标价 60000
 * 限价卖 100 USDT 换 BNB 目标价 0.99
 */
function parseLimit(text: string): LimitOrderPayload | null {
  const t = text.trim()
  const buy = t.match(
    /^限价\s*买\s+([\d.]+)\s+(\S+?)\s+的\s+(\S+?)\s+目标价\s+([\d.]+)\s*$/i,
  )
  if (buy) {
    const amount = buy[1]
    const pay = buy[2].toUpperCase()
    const target = buy[3].trim()
    const px = parseFloat(buy[4])
    if (!Number.isFinite(px) || px <= 0) return null
    let chain: BotChain = 'bsc'
    if (pay === 'ETH' || pay === 'WETH') chain = 'mainnet'
    if (pay === 'SOL') chain = 'solana'
    return {
      kind: 'limit_buy',
      chain,
      amount,
      payToken: pay,
      targetToken: target,
      targetPriceUsd: px,
    }
  }
  const sell = t.match(
    /^限价\s*卖\s+([\d.]+)\s+(\S+?)\s+换\s+(\S+?)\s+目标价\s+([\d.]+)\s*$/i,
  )
  if (sell) {
    const amount = sell[1]
    const sellTok = sell[2].trim()
    const recv = sell[3].trim()
    const px = parseFloat(sell[4])
    if (!Number.isFinite(px) || px <= 0) return null
    let chain: BotChain = 'mainnet'
    if (sellTok.toUpperCase() === 'BNB') chain = 'bsc'
    if (sellTok.toUpperCase() === 'SOL') chain = 'solana'
    return {
      kind: 'limit_sell',
      chain,
      amount,
      payToken: sellTok,
      targetToken: recv,
      targetPriceUsd: px,
    }
  }
  return null
}

/** 止盈 代币 PEPE 20% 止损 10% 卖 50% */
function parseTpSl(text: string): TpSlPayload | null {
  const t = text.trim()
  const m = t.match(
    /^(?:止盈止损|tpsl)\s+(?:(bsc|eth|ethereum|base|sol|solana|mainnet)\s+)?(\S+?)\s+止盈\s+([\d.]+)%\s+止损\s+([\d.]+)%\s+卖\s+([\d.]+)%\s*$/i,
  )
  if (!m) return null
  const chainRaw = m[1] ? normChain(m[1]) : null
  const token = m[2].trim()
  const tp = parseFloat(m[3])
  const sl = parseFloat(m[4])
  const sp = parseFloat(m[5])
  if (!Number.isFinite(tp) || !Number.isFinite(sl) || !Number.isFinite(sp)) return null
  return {
    chain: chainRaw ?? 'mainnet',
    tokenSymbolOrAddr: token,
    takeProfitPercent: tp,
    stopLossPercent: sl,
    sellPercent: Math.min(100, Math.max(1, sp)),
  }
}

/** 狙击 sol <mint> 最多 0.1 SOL */
function parseSnipe(text: string): SnipePayload | null {
  const t = text.trim()
  const m = t.match(
    /^狙击\s+(bsc|base|eth|ethereum|mainnet|sol|solana)\s+(\S+)\s+最多\s+([\d.]+)\s+(\S+)\s*$/i,
  )
  if (!m) return null
  const ch = normChain(m[1])
  if (!ch) return null
  const mintOrAddr = m[2].trim()
  const maxAmt = m[3].trim()
  const pay = m[4].trim().toUpperCase()
  return {
    chain: ch,
    mintOrAddr,
    maxPayAmount: maxAmt,
    payToken: pay,
  }
}

export function parseBootCommand(text: string): BootIntent {
  const t = text.trim()
  if (!t) return { type: 'unknown', raw: '' }

  if (/^帮助|help|\?$/i.test(t)) {
    return { type: 'help' }
  }
  if (/^任务列表|tasks?$/i.test(t)) {
    return { type: 'list_tasks' }
  }
  if (/^风控$/i.test(t) || /^风险设置$/i.test(t)) {
    return { type: 'risk_show' }
  }

  const cancel = t.match(/^取消\s+(\S+)\s*$/i)
  if (cancel) {
    return { type: 'cancel', taskId: cancel[1] }
  }

  const copyAdd = t.match(/^跟单\s+添加\s+(\S+)\s*$/i)
  if (copyAdd) {
    return { type: 'copy_add', address: copyAdd[1].trim() }
  }
  const copyRm = t.match(/^跟单\s+移除\s+(\S+)\s*$/i)
  if (copyRm) {
    return { type: 'copy_remove', address: copyRm[1].trim() }
  }
  if (/^跟单\s+开$/i.test(t)) return { type: 'copy_toggle', enabled: true }
  if (/^跟单\s+关$/i.test(t)) return { type: 'copy_toggle', enabled: false }

  const lim = parseLimit(t)
  if (lim) return { type: 'limit', payload: lim }

  const tpsl = parseTpSl(t)
  if (tpsl) return { type: 'tpsl', payload: tpsl }

  const sn = parseSnipe(t)
  if (sn) return { type: 'snipe', payload: sn }

  const sell = parseSellMessage(t)
  if (sell) return { type: 'sell', intent: sell }

  const buy = parseBuyMessage(t)
  if (buy) return { type: 'buy', intent: buy }

  return { type: 'unknown', raw: t }
}

export function bootHelpText(): string {
  return [
    '【Boot 指令】',
    '买：买 0.1 BNB 的 USDT | base 买 0.1 ETH 的 USDC',
    '卖：卖 10 USDT 换 BNB | sol 卖 1 SOL 换 USDC',
    '限价：限价买 0.1 BNB 的 USDT 目标价 600 | 限价卖 100 USDT 换 BNB 目标价 0.99',
    '止盈止损：止盈止损 PEPE 止盈 20% 止损 10% 卖 50%（可加链前缀）',
    '狙击：狙击 sol <mint> 最多 0.1 SOL',
    '跟单：跟单添加 <地址> | 跟单移除 <地址> | 跟单开 | 跟单关',
    '任务：任务列表 | 取消 <任务ID>',
    '其他：帮助 | 风控',
  ].join('\n')
}
