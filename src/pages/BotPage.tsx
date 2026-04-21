import { useCallback, useEffect, useRef, useState } from 'react'
import { useWallet } from '../components/WalletProvider'
import { deploySimpleERC20 } from '../lib/bot/deploySimpleERC20'
import { parseBuyMessage, type BotChain } from '../lib/bot/parseBuyMessage'
import { parseDeployErc20Message, type ParsedDeployErc20Intent } from '../lib/bot/parseDeployErc20'
import { isSupportedSwapNetwork } from '../lib/evm/config'
import { fetchEvmTokenByAddress } from '../lib/evm/balances'
import { getSwapTokens, getTokenBySymbol, type EvmToken } from '../lib/evm/tokens'
import { getBestLiveQuote, type LiveQuote } from '../lib/evm/quote'
import { executeQuotedSwap } from '../lib/evm/executeSwap'
import { createRpcProvider } from '../lib/evm/fastRpcProvider'
import { isEvmAddress } from '../api/jupiter'
import { NETWORK_CONFIG } from '../lib/walletConfig'
import { usePageConfig } from '../hooks/usePageConfig'

const SLIPPAGE_BPS = 200

type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'bot'
      content: string
      isError?: boolean
      txHash?: string
      txChain?: BotChain
      /** 自建 ERC20 部署成功后的合约地址 */
      contractAddress?: string
    }

function explorerAddressUrl(chain: BotChain, address: string): string {
  const txBase = NETWORK_CONFIG[chain].explorerTxBase ?? ''
  const addrBase = txBase.replace(/\/?tx\/?$/i, '/address/')
  return `${addrBase}${address}`
}

const WELCOME_MSG: ChatMessage = {
  role: 'bot',
  content:
    '【买币】买 0.1 BNB 的 USDT；base 买 0.1 ETH 的 USDC（支付 ETH 请写 base 或 eth）。支持 BSC / ETH / Base。\n【发币·自建 ERC20】bsc 发币 名称 我的币 符号 MTK 总量 1000000（全部代币铸给当前钱包；需该链原生币付 Gas）。',
}

function getQuoteErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) return '已取消签名'
  if (msg.toLowerCase().includes('insufficient')) return '余额不足'
  if (msg.includes('无报价') || msg.includes('均无报价') || msg.includes('流动性') || msg.includes('V4 路由') || msg.includes('V4 有池子') || msg.includes('[API:')) return msg
  if (msg === 'Failed to fetch' || msg.toLowerCase().includes('failed to fetch')) {
    return '网络请求失败，请检查网络或稍后重试。EVM 链需能访问路由 API。国内可尝试 VPN 或配置 API Key。'
  }
  return msg.slice(0, 80)
}

export function BotPage() {
  const { provider, signer, address, network, switchNetwork, refreshBalance } = useWallet()
  const { config } = usePageConfig('bot')
  const [messages, setMessages] = useState<ChatMessage[]>(() => [WELCOME_MSG])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'parsing' | 'switching' | 'quoting' | 'executing' | 'deploying' | 'done' | 'error'
  >('idle')
  const [, setTxHash] = useState<string | null>(null)
  const [, setTxChain] = useState<BotChain | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [pendingBuy, setPendingBuy] = useState<{
    intent: { chain: BotChain; amount: string; payToken: string; buyToken: string }
    fromToken: EvmToken
    toToken: EvmToken
  } | null>(null)
  const [pendingDeploy, setPendingDeploy] = useState<ParsedDeployErc20Intent | null>(null)

  const addBotReply = useCallback(
    (content: string, opts?: { isError?: boolean; txHash?: string; txChain?: BotChain; contractAddress?: string }) => {
      setMessages((prev) => [...prev, { role: 'bot', content, ...opts }])
    },
    [],
  )

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

  useEffect(() => {
    if (!pendingBuy || status !== 'switching') return
    const { intent, fromToken, toToken } = pendingBuy
    const targetNet = intent.chain
    if (network !== targetNet) return
    if (!provider || !address) {
      setStatus('error')
      addBotReply('Base 链需先创建或导入 EVM 钱包，请在钱包页导入助记词', { isError: true })
      setPendingBuy(null)
      return
    }
    setStatus('quoting')
    runEvmBuy(targetNet, fromToken, toToken, intent.amount, address!)
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
  }, [pendingBuy, status, network, provider, address, runEvmBuy, refreshBalance, addBotReply])

  useEffect(() => {
    if (!pendingDeploy || status !== 'switching') return
    if (network !== pendingDeploy.chain) return
    if (!signer || !address) {
      setStatus('error')
      addBotReply('请先创建或导入 EVM 钱包', { isError: true })
      setPendingDeploy(null)
      return
    }
    setStatus('deploying')
    void deploySimpleERC20(signer, {
      name: pendingDeploy.name,
      symbol: pendingDeploy.symbol,
      totalSupplyHuman: pendingDeploy.totalSupplyHuman,
    })
      .then(({ contractAddress, txHash }) => {
        setTxHash(txHash)
        setTxChain(pendingDeploy.chain)
        setStatus('done')
        addBotReply(`部署成功\n合约地址：${contractAddress}`, {
          txHash,
          txChain: pendingDeploy.chain,
          contractAddress,
        })
        refreshBalance()
      })
      .catch((e) => {
        setStatus('error')
        addBotReply(getQuoteErrorMessage(e), { isError: true })
      })
      .finally(() => setPendingDeploy(null))
  }, [pendingDeploy, status, network, signer, address, refreshBalance, addBotReply])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setTxHash(null)
    setTxChain(null)

    const deployIntent = parseDeployErc20Message(text)
    if (deployIntent) {
      setStatus('parsing')
      if (!isSupportedSwapNetwork(deployIntent.chain)) {
        setStatus('error')
        addBotReply(`暂不支持链: ${deployIntent.chain}`, { isError: true })
        return
      }
      if (!address) {
        setStatus('error')
        addBotReply('请先创建或导入 EVM 钱包', { isError: true })
        return
      }
      const targetNet = deployIntent.chain
      if (network !== targetNet) {
        setPendingDeploy(deployIntent)
        setStatus('switching')
        await switchNetwork(targetNet)
        return
      }
      if (!signer) {
        setStatus('error')
        addBotReply('请先创建或导入 EVM 钱包', { isError: true })
        return
      }
      setStatus('deploying')
      try {
        const { contractAddress, txHash } = await deploySimpleERC20(signer, {
          name: deployIntent.name,
          symbol: deployIntent.symbol,
          totalSupplyHuman: deployIntent.totalSupplyHuman,
        })
        setTxHash(txHash)
        setTxChain(targetNet)
        setStatus('done')
        addBotReply(`部署成功\n合约地址：${contractAddress}`, {
          txHash,
          txChain: targetNet,
          contractAddress,
        })
        refreshBalance()
      } catch (e) {
        setStatus('error')
        addBotReply(getQuoteErrorMessage(e), { isError: true })
      }
      return
    }

    const intent = parseBuyMessage(text)
    if (!intent) {
      setStatus('error')
      addBotReply(
        '无法识别指令。\n发币（自建 ERC20）：bsc 发币 名称 我的币 符号 MTK 总量 1000000\n买币：买 0.1 BNB 的 USDT；base 买 0.1 ETH 的 USDC',
        { isError: true },
      )
      return
    }

    setStatus('parsing')

    const targetNet = intent.chain

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
            info = await fetchEvmTokenByAddress(createRpcProvider(targetNet), buyTokenTrimmed)
          }
          return info ? ({ symbol: info.symbol, name: info.symbol, address: addr, decimals: info.decimals, isNative: false, tone: 'slate' } as EvmToken) : null
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
  }, [input, network, provider, signer, address, switchNetwork, runEvmBuy, refreshBalance, addBotReply])

  return (
    <div className="page ave-page bot-page">
      {config?.notice && (
        <div className="home-status-note" style={{ marginBottom: 12 }}>
          {config.notice}
        </div>
      )}
      <div className="ave-section bot-chat-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="bot-chat-window">
          <div className="bot-chat-header">交易助手</div>
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
                    {msg.role === 'bot' && msg.contractAddress && msg.txChain && (
                      <>
                        {' '}
                        <a href={explorerAddressUrl(msg.txChain, msg.contractAddress)} target="_blank" rel="noopener noreferrer">
                          查看合约
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
              placeholder="买 0.1 BNB 的 USDT 或 bsc 发币 名称 我的币 符号 MTK 总量 1000000"
              disabled={status === 'quoting' || status === 'executing' || status === 'deploying' || status === 'switching'}
            />
            <button
              type="button"
              className="bot-chat-send"
              onClick={handleSend}
              disabled={
                !input.trim() || status === 'quoting' || status === 'executing' || status === 'deploying' || status === 'switching'
              }
            >
              {status === 'quoting' || status === 'executing' || status === 'deploying' || status === 'switching' ? '…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
