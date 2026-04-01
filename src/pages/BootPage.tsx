import { useCallback, useEffect, useRef, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { ethers } from 'ethers'
import { useWallet } from '../components/WalletProvider'
import { useSolanaWallet } from '../hooks/useSolanaWallet'
import { usePrices } from '../hooks/usePrices'
import { parseBuyMessage, type BotChain } from '../lib/bot/parseBuyMessage'
import { parseBootCommand, bootHelpText, type ParsedSellIntent } from '../lib/boot/commandParser'
import { loadJson, saveJson, STORAGE_KEYS } from '../lib/boot/storage'
import { DEFAULT_RISK, normalizeRisk, checkRisk, recordSpend, type BootRiskConfig } from '../lib/boot/riskRules'
import { addTask, loadTasks, updateTask, cancelTask, type BootTask } from '../lib/boot/taskEngine'
import { fetchTokenPriceUsd, fetchPairLiquidityUsd } from '../lib/boot/priceFetch'
import { isSupportedSwapNetwork } from '../lib/evm/config'
import { fetchEvmTokenByAddress } from '../lib/evm/balances'
import { getSwapTokens, getTokenBySymbol, type EvmToken } from '../lib/evm/tokens'
import { getBestLiveQuote, type LiveQuote } from '../lib/evm/quote'
import { executeQuotedSwap } from '../lib/evm/executeSwap'
import { getSolanaQuoteWithFallback } from '../lib/solana/quote'
import { executeJupiterSwap } from '../lib/solana/executeSwap'
import { getSolanaTokenBySymbol } from '../lib/solana/tokens'
import { fetchTokenByMint, isEvmAddress } from '../api/jupiter'
import { SOLANA_TOKENS, type SolanaToken } from '../lib/solana/tokens'
import { NETWORK_CONFIG } from '../lib/walletConfig'
import { usePageConfig } from '../hooks/usePageConfig'
import { BootCopyPanel, BootRiskPanel, BootTaskPanel, BootTemplateBar } from '../components/boot/BootPanels'

const SLIPPAGE_BPS = 200

type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'bot'; content: string; isError?: boolean; txHash?: string; txChain?: BotChain }

type CopyState = { addresses: string[]; enabled: boolean; lastSig: Record<string, string> }

const WELCOME: ChatMessage = {
  role: 'bot',
  content: `Boot 交易站（站内版）\n${bootHelpText()}`,
}

function explorerTxBase(chain: BotChain): string {
  if (chain === 'solana') return NETWORK_CONFIG.solana.explorerTxBase ?? ''
  if (chain === 'bsc') return NETWORK_CONFIG.bsc.explorerTxBase ?? ''
  if (chain === 'base') return NETWORK_CONFIG.base.explorerTxBase ?? ''
  return NETWORK_CONFIG.mainnet.explorerTxBase ?? ''
}

function getQuoteErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) return '已取消签名'
  if (msg.toLowerCase().includes('insufficient')) return '余额不足'
  if (msg.includes('无报价') || msg.includes('均无报价') || msg.includes('流动性') || msg.includes('V4')) return msg
  if (msg === 'Failed to fetch' || msg.toLowerCase().includes('failed to fetch')) {
    return '网络请求失败，请检查网络或稍后重试。'
  }
  return msg.slice(0, 120)
}

export function BootPage() {
  const { provider, signer, address, network, switchNetwork, refreshBalance } = useWallet()
  const { keypair: solanaKeypair, address: solanaAddress, refresh: refreshSolana } = useSolanaWallet()
  const { getPrice } = usePrices()
  const { config } = usePageConfig('boot')

  const [messages, setMessages] = useState<ChatMessage[]>(() => [WELCOME])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'parsing' | 'switching' | 'quoting' | 'executing' | 'done' | 'error'>('idle')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [risk, setRisk] = useState<BootRiskConfig>(() => normalizeRisk(loadJson(STORAGE_KEYS.risk, DEFAULT_RISK)))
  const [copy, setCopy] = useState<CopyState>(() =>
    loadJson<CopyState>(STORAGE_KEYS.copy, { addresses: [], enabled: false, lastSig: {} }),
  )
  const [tasks, setTasks] = useState<BootTask[]>(() => loadTasks())
  const [pendingBuy, setPendingBuy] = useState<{
    intent: { chain: BotChain; amount: string; payToken: string; buyToken: string }
    fromToken: EvmToken | SolanaToken
    toToken: EvmToken | SolanaToken
  } | null>(null)

  const addBotReply = useCallback((content: string, opts?: { isError?: boolean; txHash?: string; txChain?: BotChain }) => {
    setMessages((prev) => [...prev, { role: 'bot', content, ...opts }])
  }, [])

  useEffect(() => {
    saveJson(STORAGE_KEYS.risk, risk)
  }, [risk])

  useEffect(() => {
    saveJson(STORAGE_KEYS.copy, copy)
  }, [copy])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const runEvmSwap = useCallback(
    async (targetNetwork: 'mainnet' | 'base' | 'bsc', fromToken: EvmToken, toToken: EvmToken, amount: string, recipient: string) => {
      if (!provider || !signer) throw new Error('请先创建或导入 EVM 钱包')
      const quote = await getBestLiveQuote({
        provider,
        network: targetNetwork,
        fromToken,
        toToken,
        amountIn: amount,
        slippagePercent: SLIPPAGE_BPS / 100,
        swapperAddress: recipient,
        useExtendedPaths: true,
      })
      const result = await executeQuotedSwap(signer, recipient, quote as LiveQuote, { onStageChange: () => {} })
      return result.swapHash
    },
    [provider, signer],
  )

  const runSolanaSwap = useCallback(
    async (fromToken: SolanaToken, toToken: SolanaToken, amount: string, userAddress: string) => {
      if (!solanaKeypair) throw new Error('请先在钱包页创建或导入 Solana 钱包')
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** fromToken.decimals)).toString()
      const quote = await getSolanaQuoteWithFallback(fromToken, toToken, amountRaw, SLIPPAGE_BPS, userAddress)
      const result = await executeJupiterSwap(solanaKeypair, quote, userAddress)
      return result.swapHash
    },
    [solanaKeypair],
  )

  const estimateUsd = useCallback(
    (symbol: string, amount: number, chain?: string) => {
      const px = getPrice(symbol, chain)
      if (px && amount > 0) return px * amount
      return Math.min(amount * 1000, risk.maxSingleTradeUsd)
    },
    [getPrice, risk.maxSingleTradeUsd],
  )

  /** 执行任务轮询：限价 / 狙击 / 止盈止损 */
  useEffect(() => {
    const tick = async () => {
      const list = loadTasks().filter((t) => t.status === 'pending')
      for (const task of list) {
        try {
          if (task.kind === 'limit_buy' || task.kind === 'limit_sell') {
            const p = task.payload as import('../lib/boot/commandParser').LimitOrderPayload & { resolvedTargetAddr?: string }
            const addr = p.resolvedTargetAddr
            if (!addr) continue
            const px = await fetchTokenPriceUsd(p.chain, addr)
            if (px == null) continue
            const hit =
              task.kind === 'limit_buy'
                ? px <= p.targetPriceUsd
                : px >= p.targetPriceUsd
            if (!hit) continue
            updateTask(task.id, { status: 'running', detail: `触发价 $${px.toFixed(4)}` })
            addBotReply(`[任务 ${task.id}] 限价条件满足，请在聊天发送对应「买/卖」指令手动成交（自动下单后续接入）。`, {})
            updateTask(task.id, { status: 'done' })
          }
          if (task.kind === 'snipe') {
            const p = task.payload as import('../lib/boot/commandParser').SnipePayload & { resolvedMint?: string }
            const addr = p.resolvedMint ?? p.mintOrAddr
            const liq = await fetchPairLiquidityUsd(p.chain, addr)
            if (liq != null && liq >= risk.minLiquidityUsd) {
              updateTask(task.id, { status: 'running', detail: `流动性 $${liq.toFixed(0)}` })
              addBotReply(
                `[任务 ${task.id}] 狙击条件：流动性已达标。请手动发送买指令：${p.chain} 买 ${p.maxPayAmount} ${p.payToken} 的 ${addr.slice(0, 8)}…`,
                {},
              )
              updateTask(task.id, { status: 'done' })
            }
          }
          if (task.kind === 'tp_sl') {
            const p = task.payload as import('../lib/boot/commandParser').TpSlPayload & {
              entryUsd?: number
              resolvedAddr?: string
            }
            if (!p.resolvedAddr || !p.entryUsd) continue
            const px = await fetchTokenPriceUsd(p.chain, p.resolvedAddr)
            if (px == null) continue
            const up = ((px - p.entryUsd) / p.entryUsd) * 100
            const tp = p.takeProfitPercent ?? 999
            const sl = p.stopLossPercent ?? -999
            if (up >= tp) {
              addBotReply(`[任务 ${task.id}] 已达止盈约 ${up.toFixed(1)}%，请手动卖出 ${p.sellPercent}%`, {})
              updateTask(task.id, { status: 'done' })
            } else if (up <= -Math.abs(sl)) {
              addBotReply(`[任务 ${task.id}] 已触止损约 ${up.toFixed(1)}%，请手动卖出 ${p.sellPercent}%`, {})
              updateTask(task.id, { status: 'done' })
            }
          }
        } catch {
          // ignore
        }
      }
      setTasks(loadTasks())
    }
    const id = window.setInterval(tick, 15_000)
    void tick()
    return () => window.clearInterval(id)
  }, [risk.minLiquidityUsd, addBotReply])

  /** Solana 跟单：检测新签名 */
  useEffect(() => {
    if (!copy.enabled || copy.addresses.length === 0) return
    const rpc = NETWORK_CONFIG.solana.rpcUrls[0]
    const conn = new Connection(rpc, 'confirmed')
    const id = window.setInterval(async () => {
      for (const addr of copy.addresses) {
        if (addr.length < 32 || addr.length > 44 || addr.startsWith('0x')) continue
        try {
          const sigs2 = await conn.getSignaturesForAddress(new PublicKey(addr), { limit: 1 })
          const latest = sigs2[0]?.signature
          if (!latest) continue
          setCopy((c) => {
            const prev = c.lastSig[addr]
            if (prev && latest !== prev) {
              queueMicrotask(() =>
                addBotReply(`[跟单] 监测到地址 ${addr.slice(0, 6)}… 有新交易：${latest.slice(0, 12)}… 请自行决定是否跟单。`, {}),
              )
            }
            return { ...c, lastSig: { ...c.lastSig, [addr]: latest } }
          })
        } catch {
          // ignore
        }
      }
    }, 45_000)
    return () => window.clearInterval(id)
  }, [copy.enabled, copy.addresses, addBotReply])

  useEffect(() => {
    if (!pendingBuy || status !== 'switching') return
    const { intent, fromToken, toToken } = pendingBuy
    const targetNet = intent.chain
    if (targetNet === 'solana') {
      if (network !== 'solana') return
      setStatus('quoting')
      runSolanaSwap(fromToken as SolanaToken, toToken as SolanaToken, intent.amount, solanaAddress!)
        .then((hash) => {
          setStatus('done')
          addBotReply('成交成功', { txHash: hash, txChain: 'solana' })
          refreshSolana()
        })
        .catch((e) => {
          setStatus('error')
          addBotReply(getQuoteErrorMessage(e), { isError: true })
        })
        .finally(() => setPendingBuy(null))
    } else {
      if (network !== targetNet) return
      if (!provider || !address) {
        setStatus('error')
        addBotReply('请先创建或导入 EVM 钱包', { isError: true })
        setPendingBuy(null)
        return
      }
      setStatus('quoting')
      runEvmSwap(targetNet, fromToken as EvmToken, toToken as EvmToken, intent.amount, address)
        .then((hash) => {
          setStatus('done')
          addBotReply('成交成功', { txHash: hash, txChain: targetNet })
          refreshBalance()
        })
        .catch((e) => {
          setStatus('error')
          addBotReply(getQuoteErrorMessage(e), { isError: true })
        })
        .finally(() => setPendingBuy(null))
    }
  }, [pendingBuy, status, network, provider, address, solanaAddress, runEvmSwap, runSolanaSwap, refreshBalance, refreshSolana, addBotReply])

  const executeBuyFlow = useCallback(
    async (text: string) => {
      const intent = parseBuyMessage(text)
      if (!intent) {
        addBotReply('无法解析买入指令', { isError: true })
        return
      }
      const usd = estimateUsd(intent.payToken, parseFloat(intent.amount))
      const target = intent.buyToken.trim().toLowerCase()
      const r = checkRisk(risk, {
        chain: intent.chain,
        targetAddress: target.startsWith('0x') ? target : `sym:${target}`,
        estimatedUsd: usd,
        slippagePercent: SLIPPAGE_BPS / 100,
      })
      if (!r.ok) {
        addBotReply(r.reason, { isError: true })
        return
      }

      const targetNet = intent.chain
      const isSol = targetNet === 'solana'

      if (isSol) {
        const tokens = SOLANA_TOKENS
        const buyTrimmed = intent.buyToken.trim()
        const looksLikeMint = buyTrimmed.length >= 32 && buyTrimmed.length <= 55 && !buyTrimmed.startsWith('0x')
        let fromToken: SolanaToken | null = getSolanaTokenBySymbol(intent.payToken)
        let toToken: SolanaToken | null = looksLikeMint
          ? await fetchTokenByMint(buyTrimmed).then((r2) =>
              r2
                ? { symbol: r2.symbol, name: r2.name, mint: buyTrimmed, address: r2.address, decimals: r2.decimals, isNative: false, tone: 'slate' } as SolanaToken
                : null,
            )
          : getSolanaTokenBySymbol(buyTrimmed)
        if (!toToken && looksLikeMint) {
          toToken = { symbol: `${buyTrimmed.slice(0, 4)}…`, name: 'Unknown', mint: buyTrimmed, address: buyTrimmed, decimals: 6, isNative: false, tone: 'slate' }
        }
        if (!fromToken) fromToken = tokens[0]
        if (!toToken || !fromToken) {
          addBotReply('未找到代币', { isError: true })
          return
        }
        if (!solanaKeypair || !solanaAddress) {
          addBotReply('请先导入 Solana 钱包', { isError: true })
          return
        }
        setPendingBuy({ intent, fromToken, toToken })
        if (network !== 'solana') {
          setStatus('switching')
          await switchNetwork('solana')
        } else {
          setStatus('quoting')
          runSolanaSwap(fromToken, toToken, intent.amount, solanaAddress)
            .then((hash) => {
              setStatus('done')
              addBotReply('购买成功', { txHash: hash, txChain: 'solana' })
              setRisk((prev) => recordSpend(prev, usd))
              refreshSolana()
            })
            .catch((e) => {
              setStatus('error')
              addBotReply(getQuoteErrorMessage(e), { isError: true })
            })
            .finally(() => setPendingBuy(null))
        }
      } else {
        if (!isSupportedSwapNetwork(targetNet)) {
          addBotReply(`暂不支持链: ${targetNet}`, { isError: true })
          return
        }
        const tokens = getSwapTokens(targetNet)
        let fromToken: EvmToken | null = getTokenBySymbol(targetNet, intent.payToken)
        const buyTokenTrimmed = intent.buyToken.trim()
        let toToken: EvmToken | null = isEvmAddress(buyTokenTrimmed)
          ? await (async () => {
              const addr = buyTokenTrimmed.toLowerCase()
              let info: { symbol: string; decimals: number } | null = null
              if (network === targetNet && provider) info = await fetchEvmTokenByAddress(provider, buyTokenTrimmed)
              if (!info) {
                for (const rpc of NETWORK_CONFIG[targetNet].rpcUrls) {
                  const prov = new ethers.JsonRpcProvider(rpc)
                  info = await fetchEvmTokenByAddress(prov, buyTokenTrimmed)
                  if (info) break
                }
              }
              return info ? { symbol: info.symbol, name: info.symbol, address: addr, decimals: info.decimals, isNative: false, tone: 'slate' } as EvmToken : null
            })()
          : getTokenBySymbol(targetNet, buyTokenTrimmed)
        if (!fromToken) fromToken = tokens.find((t) => t.isNative) ?? tokens[0]
        if (!toToken || !fromToken) {
          addBotReply('未找到代币', { isError: true })
          return
        }
        if (!address) {
          addBotReply('请先导入 EVM 钱包', { isError: true })
          return
        }
        setPendingBuy({ intent, fromToken, toToken })
        if (network !== targetNet) {
          setStatus('switching')
          await switchNetwork(targetNet)
        } else if (provider && signer) {
          setStatus('quoting')
          runEvmSwap(targetNet, fromToken, toToken, intent.amount, address)
            .then((hash) => {
              setStatus('done')
              addBotReply('购买成功', { txHash: hash, txChain: targetNet })
              setRisk((prev) => recordSpend(prev, usd))
              refreshBalance()
            })
            .catch((e) => {
              setStatus('error')
              addBotReply(getQuoteErrorMessage(e), { isError: true })
            })
            .finally(() => setPendingBuy(null))
        }
      }
    },
    [addBotReply, address, estimateUsd, network, provider, risk, runEvmSwap, runSolanaSwap, signer, solanaAddress, solanaKeypair, switchNetwork, refreshBalance, refreshSolana],
  )

  const executeSellFlow = useCallback(
    async (intent: ParsedSellIntent) => {
      const usd = estimateUsd(intent.sellToken, parseFloat(intent.amount))
      const tgt = intent.sellToken.trim().toLowerCase()
      const r = checkRisk(risk, {
        chain: intent.chain,
        targetAddress: tgt.startsWith('0x') ? tgt : `sym:${tgt}`,
        estimatedUsd: usd,
        slippagePercent: SLIPPAGE_BPS / 100,
      })
      if (!r.ok) {
        addBotReply(r.reason, { isError: true })
        return
      }

      if (intent.chain === 'solana') {
        let fromToken: SolanaToken | null = getSolanaTokenBySymbol(intent.sellToken)
        let toToken: SolanaToken | null = getSolanaTokenBySymbol(intent.receiveToken)
        const st = intent.sellToken.trim()
        if (st.length >= 32 && !st.startsWith('0x')) {
          const ft = await fetchTokenByMint(st)
          if (ft)
            fromToken = { symbol: ft.symbol, name: ft.name, mint: st, address: ft.address, decimals: ft.decimals, isNative: false, tone: 'slate' }
        }
        if (!fromToken || !toToken) {
          addBotReply('卖出：未找到代币符号', { isError: true })
          return
        }
        if (!solanaKeypair || !solanaAddress) {
          addBotReply('请先导入 Solana 钱包', { isError: true })
          return
        }
        if (network !== 'solana') {
          setStatus('switching')
          await switchNetwork('solana')
          await new Promise((r) => setTimeout(r, 600))
        }
        setStatus('quoting')
        runSolanaSwap(fromToken, toToken, intent.amount, solanaAddress)
          .then((hash) => {
            setStatus('done')
            addBotReply('卖出成功', { txHash: hash, txChain: 'solana' })
            setRisk((prev) => recordSpend(prev, usd))
            refreshSolana()
          })
          .catch((e) => {
            setStatus('error')
            addBotReply(getQuoteErrorMessage(e), { isError: true })
          })
      } else {
        if (!isSupportedSwapNetwork(intent.chain)) {
          addBotReply('暂不支持该链', { isError: true })
          return
        }
        const net = intent.chain
        let fromToken: EvmToken | null = getTokenBySymbol(net, intent.sellToken)
        const sellTrim = intent.sellToken.trim()
        if (isEvmAddress(sellTrim)) {
          const info = provider ? await fetchEvmTokenByAddress(provider, sellTrim) : null
          if (info)
            fromToken = { symbol: info.symbol, name: info.symbol, address: sellTrim.toLowerCase(), decimals: info.decimals, isNative: false, tone: 'slate' }
        }
        let toToken: EvmToken | null = getTokenBySymbol(net, intent.receiveToken)
        if (!fromToken || !toToken) {
          addBotReply('卖出：未找到代币', { isError: true })
          return
        }
        if (!address) {
          addBotReply('请先导入钱包', { isError: true })
          return
        }
        if (network !== net) {
          setStatus('switching')
          await switchNetwork(net)
          await new Promise((r) => setTimeout(r, 600))
        }
        setStatus('quoting')
        runEvmSwap(net, fromToken, toToken, intent.amount, address)
          .then((hash) => {
            setStatus('done')
            addBotReply('卖出成功', { txHash: hash, txChain: net })
            setRisk((prev) => recordSpend(prev, usd))
            refreshBalance()
          })
          .catch((e) => {
            setStatus('error')
            addBotReply(getQuoteErrorMessage(e), { isError: true })
          })
      }
    },
    [addBotReply, address, estimateUsd, network, provider, risk, runEvmSwap, runSolanaSwap, solanaAddress, solanaKeypair, switchNetwork, refreshBalance, refreshSolana],
  )

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setStatus('parsing')

    const intent = parseBootCommand(text)

    if (intent.type === 'help') {
      addBotReply(bootHelpText())
      setStatus('idle')
      return
    }
    if (intent.type === 'list_tasks') {
      const list = loadTasks()
        .filter((t) => t.status === 'pending' || t.status === 'running')
        .map((t) => `${t.id} ${t.title}`)
        .join('\n')
      addBotReply(list || '无任务')
      setStatus('idle')
      return
    }
    if (intent.type === 'risk_show') {
      addBotReply(
        `滑点上限 ${risk.maxSlippagePercent}% 单笔 $${risk.maxSingleTradeUsd} 日预算 $${risk.dailyBudgetUsd} 流动性下限 $${risk.minLiquidityUsd}`,
      )
      setStatus('idle')
      return
    }
    if (intent.type === 'cancel') {
      cancelTask(intent.taskId)
      setTasks(loadTasks())
      addBotReply(`已取消任务 ${intent.taskId}`)
      setStatus('idle')
      return
    }
    if (intent.type === 'copy_add') {
      const a = intent.address.trim()
      if (!copy.addresses.includes(a)) setCopy((c) => ({ ...c, addresses: [...c.addresses, a] }))
      addBotReply(`已添加跟单地址 ${a.slice(0, 8)}…`)
      setStatus('idle')
      return
    }
    if (intent.type === 'copy_remove') {
      setCopy((c) => ({ ...c, addresses: c.addresses.filter((x) => x !== intent.address) }))
      addBotReply('已移除')
      setStatus('idle')
      return
    }
    if (intent.type === 'copy_toggle') {
      setCopy((c) => ({ ...c, enabled: intent.enabled }))
      addBotReply(intent.enabled ? '跟单已开启' : '跟单已关闭')
      setStatus('idle')
      return
    }
    if (intent.type === 'limit') {
      const p = intent.payload
      let resolved = ''
      if (p.kind === 'limit_buy') {
        const sym = p.targetToken
        if (sym.startsWith('0x') && sym.length === 42) resolved = sym
        else if (isSupportedSwapNetwork(p.chain)) {
          const t = getTokenBySymbol(p.chain, sym)
          if (t) resolved = t.address
        }
      } else {
        const sym = p.payToken
        if (sym.startsWith('0x') && sym.length === 42) resolved = sym
        else if (isSupportedSwapNetwork(p.chain)) {
          const t = getTokenBySymbol(p.chain, sym)
          if (t) resolved = t.address
        }
      }
      const t = addTask({
        kind: p.kind === 'limit_buy' ? 'limit_buy' : 'limit_sell',
        title: `限价 ${p.kind} ${p.targetToken}`,
        payload: { ...p, resolvedTargetAddr: resolved || undefined },
      })
      setTasks(loadTasks())
      addBotReply(`已创建限价任务 ${t.id}（轮询 DexScreener 价格，触发后请手动确认交易）`)
      setStatus('idle')
      return
    }
    if (intent.type === 'snipe') {
      const p = intent.payload
      const t = addTask({
        kind: 'snipe',
        title: `狙击 ${p.mintOrAddr.slice(0, 8)}…`,
        payload: { ...p, resolvedMint: p.mintOrAddr },
      })
      setTasks(loadTasks())
      addBotReply(`已创建狙击任务 ${t.id}`)
      setStatus('idle')
      return
    }
    if (intent.type === 'tpsl') {
      const p = intent.payload
      let resolvedAddr = ''
      const sym = p.tokenSymbolOrAddr
      if (sym.startsWith('0x') && sym.length === 42) resolvedAddr = sym.toLowerCase()
      else if (p.chain === 'solana' || sym.length >= 32) resolvedAddr = sym
      else if (isSupportedSwapNetwork(p.chain)) {
        const t = getTokenBySymbol(p.chain, sym)
        if (t) resolvedAddr = t.address
      }
      const entry = resolvedAddr ? await fetchTokenPriceUsd(p.chain, resolvedAddr) : null
      const t = addTask({
        kind: 'tp_sl',
        title: `止盈止损 ${sym}`,
        payload: { ...p, resolvedAddr: resolvedAddr || undefined, entryUsd: entry ?? undefined },
      })
      setTasks(loadTasks())
      addBotReply(`已创建止盈止损任务 ${t.id}${entry ? ` 参考价 $${entry.toFixed(6)}` : ''}`)
      setStatus('idle')
      return
    }
    if (intent.type === 'sell') {
      await executeSellFlow(intent.intent)
      return
    }
    if (intent.type === 'buy') {
      await executeBuyFlow(text)
      return
    }

    addBotReply('未识别指令。输入「帮助」查看格式', { isError: true })
    setStatus('idle')
  }, [addBotReply, copy.addresses, executeBuyFlow, executeSellFlow, risk])

  return (
    <div className="page ave-page bot-page boot-page">
      {config?.notice && (
        <div className="home-status-note" style={{ marginBottom: 12 }}>
          {config.notice}
        </div>
      )}
      <BootTemplateBar onApplyTemplate={(t) => setInput(t)} />
      <div className="boot-grid">
        <div className="ave-section bot-chat-section boot-chat" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="bot-chat-window">
            <div className="bot-chat-header">Boot 交易</div>
            <div className="bot-chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`bot-chat-msg ${msg.role}`}>
                  <div className="bot-chat-avatar">{msg.role === 'bot' ? 'B' : '我'}</div>
                  <div>
                    <div className={`bot-chat-bubble ${msg.role === 'bot' && msg.isError ? 'error' : ''}`}>
                      {msg.content.split('\n').map((line, j) => (
                        <span key={j}>
                          {line}
                          {j < msg.content.split('\n').length - 1 && <br />}
                        </span>
                      ))}
                      {msg.role === 'bot' && msg.txHash && msg.txChain && (
                        <>
                          {' '}
                          <a href={`${explorerTxBase(msg.txChain)}${msg.txHash}`} target="_blank" rel="noopener noreferrer">
                            查看交易
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="bot-chat-input-bar">
              <input
                type="text"
                className="bot-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleSend()}
                placeholder="买 0.1 BNB 的 USDT / 卖 10 USDT 换 BNB / 帮助"
                disabled={status === 'quoting' || status === 'executing' || status === 'switching'}
              />
              <button
                type="button"
                className="bot-chat-send"
                onClick={() => void handleSend()}
                disabled={!input.trim() || status === 'quoting' || status === 'executing' || status === 'switching'}
              >
                {status === 'quoting' || status === 'executing' || status === 'switching' ? '…' : '发送'}
              </button>
            </div>
          </div>
        </div>
        <div className="boot-side">
          <BootTaskPanel tasks={tasks} onCancel={(id) => { cancelTask(id); setTasks(loadTasks()); addBotReply(`已取消 ${id}`) }} />
          <BootRiskPanel risk={risk} onRiskChange={(r) => setRisk(normalizeRisk(r))} />
          <BootCopyPanel
            copy={copy}
            onCopyRemove={(a) => setCopy((c) => ({ ...c, addresses: c.addresses.filter((x) => x !== a) }))}
            onCopyToggle={() => setCopy((c) => ({ ...c, enabled: !c.enabled }))}
          />
        </div>
      </div>
    </div>
  )
}
