import { useCallback, useEffect, useRef, useState } from 'react'
import { useWallet } from '../components/WalletProvider'
import { useSolanaWallet } from '../hooks/useSolanaWallet'
import { parseBuyMessage, type BotChain } from '../lib/bot/parseBuyMessage'
import { isSupportedSwapNetwork } from '../lib/evm/config'
import { fetchEvmTokenByAddress } from '../lib/evm/balances'
import { getSwapTokens, getTokenBySymbol, type EvmToken } from '../lib/evm/tokens'
import { getBestLiveQuote, type LiveQuote } from '../lib/evm/quote'
import { executeQuotedSwap } from '../lib/evm/executeSwap'
import { getSolanaQuoteWithFallback } from '../lib/solana/quote'
import { executeJupiterSwap } from '../lib/solana/executeSwap'
import { getSolanaTokenBySymbol } from '../lib/solana/tokens'
import { fetchTokenByMint, isEvmAddress, isSolanaMint } from '../api/jupiter'
import { SOLANA_TOKENS, type SolanaToken } from '../lib/solana/tokens'
import { NETWORK_CONFIG } from '../lib/walletConfig'
import { ethers } from 'ethers'

const SLIPPAGE_BPS = 200

type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'bot'; content: string; isError?: boolean; txHash?: string; txChain?: BotChain }

const WELCOME_MSG: ChatMessage = {
  role: 'bot',
  content: '发送购买指令即可买币，自动选最优路由。\n格式示例：买 0.1 BNB 的 USDT  base 买 0.1 ETH 的 USDC  eth 买 0.1 ETH 的 USDT\n支付 ETH 时请写明链名（base 或 eth），支持 BSC、ETH、Base、Sol 链。',
}

function getQuoteErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) return '已取消签名'
  if (msg.toLowerCase().includes('insufficient')) return '余额不足'
  if (msg.includes('无报价') || msg.includes('均无报价') || msg.includes('流动性') || msg.includes('V4 路由') || msg.includes('V4 有池子') || msg.includes('[API:')) return msg
  if (msg === 'Failed to fetch' || msg.toLowerCase().includes('failed to fetch')) {
    return '网络请求失败，请检查网络或稍后重试。若在使用 Uniswap API，请确认可访问外网且 API Key 有效。'
  }
  return msg.slice(0, 80)
}

export function BotPage() {
  const { provider, signer, address, network, switchNetwork, refreshBalance } = useWallet()
  const { keypair: solanaKeypair, address: solanaAddress, refresh: refreshSolana } = useSolanaWallet()
  const [messages, setMessages] = useState<ChatMessage[]>(() => [WELCOME_MSG])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'parsing' | 'switching' | 'quoting' | 'executing' | 'done' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txChain, setTxChain] = useState<BotChain | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [pendingBuy, setPendingBuy] = useState<{
    intent: { chain: BotChain; amount: string; payToken: string; buyToken: string }
    fromToken: EvmToken | SolanaToken
    toToken: EvmToken | SolanaToken
  } | null>(null)

  const addBotReply = useCallback((content: string, opts?: { isError?: boolean; txHash?: string; txChain?: BotChain }) => {
    setMessages((prev) => [...prev, { role: 'bot', content, ...opts }])
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const runEvmBuy = useCallback(
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
      const result = await executeQuotedSwap(signer, recipient, quote as LiveQuote, {
        onStageChange: () => {},
      })
      return result.swapHash
    },
    [provider, signer],
  )

  const runSolanaBuy = useCallback(
    async (fromToken: SolanaToken, toToken: SolanaToken, amount: string, userAddress: string) => {
      if (!solanaKeypair) throw new Error('请先在钱包页创建或导入 Solana 钱包')
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** fromToken.decimals)).toString()
      const quote = await getSolanaQuoteWithFallback(fromToken, toToken, amountRaw, SLIPPAGE_BPS, userAddress)
      const result = await executeJupiterSwap(solanaKeypair, quote, userAddress)
      return result.swapHash
    },
    [solanaKeypair],
  )

  useEffect(() => {
    if (!pendingBuy || status !== 'switching') return
    const { intent, fromToken, toToken } = pendingBuy
    const targetNet = intent.chain
    if (targetNet === 'solana') {
      if (network !== 'solana') return
      setStatus('quoting')
      runSolanaBuy(
        fromToken as SolanaToken,
        toToken as SolanaToken,
        intent.amount,
        solanaAddress!,
      )
        .then((hash) => {
          setTxHash(hash)
          setTxChain('solana')
          setStatus('done')
          addBotReply('购买成功', { txHash: hash, txChain: 'solana' })
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
        addBotReply('Base 链需先创建或导入 EVM 钱包，请在钱包页导入助记词', { isError: true })
        setPendingBuy(null)
        return
      }
      setStatus('quoting')
      runEvmBuy(
        targetNet,
        fromToken as EvmToken,
        toToken as EvmToken,
        intent.amount,
        address!,
      )
        .then((hash) => {
          setTxHash(hash)
          setTxChain(targetNet)
          setStatus('done')
          addBotReply('购买成功', { txHash: hash, txChain: targetNet })
          refreshBalance()
        })
        .catch((e) => {
          setStatus('error')
          addBotReply(getQuoteErrorMessage(e), { isError: true })
        })
        .finally(() => setPendingBuy(null))
    }
  }, [pendingBuy, status, network, provider, address, solanaAddress, runEvmBuy, runSolanaBuy, refreshBalance, refreshSolana, addBotReply])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setTxHash(null)
    setTxChain(null)

    const intent = parseBuyMessage(text)
    if (!intent) {
      setStatus('error')
      addBotReply('无法解析。格式：买 0.1 BNB 的 USDT；支付 ETH 时请写 base 或 eth，如 base 买 0.1 ETH 的 USDC', { isError: true })
      return
    }

    setStatus('parsing')

    const targetNet = intent.chain
    const isSol = targetNet === 'solana'

    if (isSol) {
      const tokens = SOLANA_TOKENS
      const buyTrimmed = intent.buyToken.trim()
      const looksLikeMint = buyTrimmed.length >= 32 && buyTrimmed.length <= 55 && !buyTrimmed.startsWith('0x')
      let fromToken: SolanaToken | null = getSolanaTokenBySymbol(intent.payToken)
      let toToken: SolanaToken | null =
        looksLikeMint
          ? await fetchTokenByMint(buyTrimmed).then((r) =>
              r ? { symbol: r.symbol, name: r.name, mint: buyTrimmed, address: r.address, decimals: r.decimals, isNative: false, tone: 'slate' } as SolanaToken : null,
            )
          : getSolanaTokenBySymbol(buyTrimmed)
      if (!toToken && looksLikeMint) {
        toToken = { symbol: `${buyTrimmed.slice(0, 4)}…${buyTrimmed.slice(-4)}`, name: 'Unknown', mint: buyTrimmed, address: buyTrimmed, decimals: 6, isNative: false, tone: 'slate' }
      }
      if (!fromToken) fromToken = tokens[0]
      if (!toToken) {
        setStatus('error')
        addBotReply(`未找到代币: ${intent.buyToken}`, { isError: true })
        return
      }
      if (!solanaKeypair || !solanaAddress) {
        setStatus('error')
        addBotReply('请先在钱包页创建或导入 Solana 钱包', { isError: true })
        return
      }
      setPendingBuy({ intent, fromToken, toToken })
      if (network !== 'solana') {
        setStatus('switching')
        await switchNetwork('solana')
      } else {
        setStatus('quoting')
        runSolanaBuy(fromToken, toToken, intent.amount, solanaAddress)
          .then((hash) => {
            setTxHash(hash)
            setTxChain('solana')
            setStatus('done')
            addBotReply('购买成功', { txHash: hash, txChain: 'solana' })
            refreshSolana()
          })
          .catch((e) => {
            setStatus('error')
            addBotReply(getQuoteErrorMessage(e), { isError: true })
          })
      }
    } else {
      if (!isSupportedSwapNetwork(targetNet)) {
        setStatus('error')
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
            if (network === targetNet && provider) {
              info = await fetchEvmTokenByAddress(provider, buyTokenTrimmed)
            }
            if (!info) {
              const rpcUrls = NETWORK_CONFIG[targetNet].rpcUrls
              for (const rpc of rpcUrls) {
                const prov = new ethers.JsonRpcProvider(rpc)
                info = await fetchEvmTokenByAddress(prov, buyTokenTrimmed)
                if (info) break
              }
            }
            return info ? { symbol: info.symbol, name: info.symbol, address: addr, decimals: info.decimals, isNative: false, tone: 'slate' } as EvmToken : null
          })()
        : getTokenBySymbol(targetNet, buyTokenTrimmed)
      if (!fromToken) fromToken = tokens.find((t) => t.isNative) ?? tokens[0]
      if (!toToken) {
        setStatus('error')
        addBotReply(`未找到代币: ${intent.buyToken}`, { isError: true })
        return
      }
      if (!address) {
        setStatus('error')
        addBotReply('请先创建或导入 EVM 钱包', { isError: true })
        return
      }
      setPendingBuy({ intent, fromToken, toToken })
      if (network !== targetNet) {
        setStatus('switching')
        await switchNetwork(targetNet)
      } else if (provider && signer) {
        setStatus('quoting')
        runEvmBuy(targetNet, fromToken, toToken, intent.amount, address)
          .then((hash) => {
            setTxHash(hash)
            setTxChain(targetNet)
            setStatus('done')
            addBotReply('购买成功', { txHash: hash, txChain: targetNet })
            refreshBalance()
          })
          .catch((e) => {
            setStatus('error')
            addBotReply(getQuoteErrorMessage(e), { isError: true })
          })
      }
    }
  }, [input, network, provider, signer, address, solanaKeypair, solanaAddress, switchNetwork, runEvmBuy, runSolanaBuy, refreshBalance, refreshSolana, addBotReply])

  return (
    <div className="page ave-page bot-page">
      <div className="ave-section bot-chat-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="bot-chat-window">
          <div className="bot-chat-header">购买助手</div>
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
                        <a
                          href={`${NETWORK_CONFIG[msg.txChain].explorerTxBase}${msg.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
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
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="bsc 买 0.1 BNB 的 USDT"
              disabled={status === 'quoting' || status === 'executing' || status === 'switching'}
            />
            <button
              type="button"
              className="bot-chat-send"
              onClick={handleSend}
              disabled={!input.trim() || status === 'quoting' || status === 'executing' || status === 'switching'}
            >
              {status === 'quoting' || status === 'executing' || status === 'switching' ? '…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
