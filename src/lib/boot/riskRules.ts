import type { BotChain } from '../bot/parseBuyMessage'

/** 风控配置（本地 + 可被后台 notice 覆盖部分说明） */
export interface BootRiskConfig {
  maxSlippagePercent: number
  maxSingleTradeUsd: number
  dailyBudgetUsd: number
  minLiquidityUsd: number
  /** 黑名单：合约/mint 小写 */
  blacklist: string[]
  /** 白名单：空表示不限制；非空则仅允许列表内目标 */
  whitelist: string[]
  /** 当日已用 USD（粗略，仅前端估算） */
  spentTodayUsd: number
  /** 日期 YYYY-MM-DD */
  spentDay: string
}

export const DEFAULT_RISK: BootRiskConfig = {
  maxSlippagePercent: 5,
  maxSingleTradeUsd: 5000,
  dailyBudgetUsd: 20000,
  minLiquidityUsd: 5000,
  blacklist: [],
  whitelist: [],
  spentTodayUsd: 0,
  spentDay: '',
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function normalizeRisk(r: Partial<BootRiskConfig>): BootRiskConfig {
  const day = todayStr()
  let spent = r.spentTodayUsd ?? 0
  let spentDay = r.spentDay ?? ''
  if (spentDay !== day) {
    spent = 0
    spentDay = day
  }
  return {
    maxSlippagePercent: Math.min(50, Math.max(0.1, r.maxSlippagePercent ?? DEFAULT_RISK.maxSlippagePercent)),
    maxSingleTradeUsd: Math.max(0, r.maxSingleTradeUsd ?? DEFAULT_RISK.maxSingleTradeUsd),
    dailyBudgetUsd: Math.max(0, r.dailyBudgetUsd ?? DEFAULT_RISK.dailyBudgetUsd),
    minLiquidityUsd: Math.max(0, r.minLiquidityUsd ?? DEFAULT_RISK.minLiquidityUsd),
    blacklist: Array.isArray(r.blacklist) ? r.blacklist.map((x) => String(x).toLowerCase()) : [],
    whitelist: Array.isArray(r.whitelist) ? r.whitelist.map((x) => String(x).toLowerCase()) : [],
    spentTodayUsd: spent,
    spentDay,
  }
}

export interface RiskCheckContext {
  chain: BotChain
  /** 目标代币地址或 mint */
  targetAddress: string
  /** 本次交易估算 USD 金额 */
  estimatedUsd: number
  /** 当前滑点 % */
  slippagePercent: number
  /** 可选：池子流动性 USD（未知则跳过 minLiquidity 检查） */
  liquidityUsd?: number
}

export type RiskResult = { ok: true } | { ok: false; reason: string }

export function checkRisk(config: BootRiskConfig, ctx: RiskCheckContext): RiskResult {
  const target = ctx.targetAddress.trim().toLowerCase()
  if (config.blacklist.includes(target)) {
    return { ok: false, reason: '目标地址在黑名单中' }
  }
  if (config.whitelist.length > 0 && !config.whitelist.includes(target)) {
    return { ok: false, reason: '目标地址不在白名单（已开启白名单模式）' }
  }
  if (ctx.slippagePercent > config.maxSlippagePercent) {
    return { ok: false, reason: `滑点 ${ctx.slippagePercent}% 超过上限 ${config.maxSlippagePercent}%` }
  }
  if (ctx.estimatedUsd > config.maxSingleTradeUsd) {
    return { ok: false, reason: `单笔约 $${ctx.estimatedUsd.toFixed(0)} 超过单笔上限 $${config.maxSingleTradeUsd}` }
  }
  const day = todayStr()
  let spent = config.spentTodayUsd
  if (config.spentDay !== day) spent = 0
  if (spent + ctx.estimatedUsd > config.dailyBudgetUsd) {
    return { ok: false, reason: `今日已用约 $${spent.toFixed(0)}，再加 $${ctx.estimatedUsd.toFixed(0)} 会超过日预算 $${config.dailyBudgetUsd}` }
  }
  if (ctx.liquidityUsd != null && ctx.liquidityUsd < config.minLiquidityUsd) {
    return { ok: false, reason: `流动性约 $${ctx.liquidityUsd.toFixed(0)} 低于最低 $${config.minLiquidityUsd}` }
  }
  return { ok: true }
}

export function recordSpend(config: BootRiskConfig, usd: number): BootRiskConfig {
  const day = todayStr()
  let spent = config.spentTodayUsd
  if (config.spentDay !== day) spent = 0
  return normalizeRisk({
    ...config,
    spentTodayUsd: spent + usd,
    spentDay: day,
  })
}
