import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ethers } from 'ethers'
import { useWallet } from '../components/WalletProvider'
import { NETWORK_CONFIG } from '../lib/walletConfig'
import { usePrices } from '../hooks/usePrices'
import { readTrackedTokenBalances } from '../lib/evm/balances'
import { isSupportedSwapNetwork } from '../lib/evm/config'
import { getSwapTokens, getTokenBySymbol } from '../lib/evm/tokens'
import { ERC20_ABI } from '../lib/evm/abis'

interface Holding {
  symbol: string
  amount: string
}

interface WalletRow {
  symbol: string
  subtitle: string
  amount: string
  value: string
  numericValue: number
  avatar: string
  avatarTone: 'sky' | 'violet' | 'gold' | 'emerald' | 'rose' | 'slate'
  chainBadge: string
  chainTone: 'base' | 'eth' | 'bsc' | 'polygon'
  tone: 'up' | 'down' | 'flat'
}

type WalletQuickAction = 'receive' | 'send' | 'scan' | 'bridge'

function getAvatarTone(symbol: string): WalletRow['avatarTone'] {
  if (symbol === 'ETH' || symbol === 'WETH') return 'slate'
  if (symbol === 'USDT' || symbol === 'USDC') return 'emerald'
  if (symbol === 'VIRTUAL') return 'violet'
  if (symbol === 'Mutual') return 'gold'
  if (symbol === 'Preguntale') return 'rose'
  return 'sky'
}

function getChainInfo(network: string): Pick<WalletRow, 'chainBadge' | 'chainTone'> {
  if (network === 'base') return { chainBadge: 'B', chainTone: 'base' }
  if (network === 'bsc') return { chainBadge: 'B', chainTone: 'bsc' }
  if (network === 'polygon') return { chainBadge: 'P', chainTone: 'polygon' }
  return { chainBadge: 'E', chainTone: 'eth' }
}

function WalletQuickIcon({ kind }: { kind: WalletQuickAction }) {
  switch (kind) {
    case 'receive':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5.25V16.25" />
          <path d="M7.75 12L12 16.25L16.25 12" />
          <path d="M6.75 18.75H17.25" />
        </svg>
      )
    case 'send':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5.75 12H16.25" />
          <path d="M12 7.75L16.25 12L12 16.25" />
          <path d="M6.75 6.75H17.25" opacity="0.45" />
        </svg>
      )
    case 'scan':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8.25 5.75H5.75V8.25" />
          <path d="M15.75 5.75H18.25V8.25" />
          <path d="M8.25 18.25H5.75V15.75" />
          <path d="M15.75 18.25H18.25V15.75" />
          <path d="M9 12H15" />
        </svg>
      )
    case 'bridge':
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6.75 16.25C7.8 12.25 16.2 12.25 17.25 8.25" />
          <path d="M6.75 8.25H10.25" />
          <path d="M13.75 16.25H17.25" />
          <path d="M8.25 6.75L10.25 8.25L8.25 9.75" />
          <path d="M15.75 14.75L13.75 16.25L15.75 17.75" />
        </svg>
      )
  }
}

export function WalletPage() {
  const { address, balance, createWallet, importWallet, network, provider, signer, connecting, refreshNonce, refreshBalance } = useWallet()
  const { getPrice } = usePrices()
  const walletValuesVisibleKey = `walletValuesVisible:${network}`
  const walletHideSmallKey = `walletHideSmall:${network}`
  const walletQuickActionKey = `walletQuickAction:${network}`
  const [importMnemonic, setImportMnemonic] = useState('')
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [showSetup, setShowSetup] = useState(false)
  const [valuesVisible, setValuesVisible] = useState(true)
  const [hideSmallAssets, setHideSmallAssets] = useState(false)
  const [quickAction, setQuickAction] = useState<WalletQuickAction>('receive')
  const [searchTerm, setSearchTerm] = useState('')
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [activeRowSymbol, setActiveRowSymbol] = useState<string | null>(null)
  const [quickSheetOpen, setQuickSheetOpen] = useState(false)
  const [panelNotice, setPanelNotice] = useState<string | null>(null)
  const symbol = NETWORK_CONFIG[network].symbol
  const [sendTokenSymbol, setSendTokenSymbol] = useState<string>(symbol)
  const [sendToAddress, setSendToAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendLoading, setSendLoading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const isObserveWallet = !address

  useEffect(() => {
    const v = window.localStorage.getItem(walletValuesVisibleKey) !== '0'
    const h = window.localStorage.getItem(walletHideSmallKey) === '1'
    const q = (window.localStorage.getItem(walletQuickActionKey) as WalletQuickAction | null) ?? 'receive'
    queueMicrotask(() => {
      setValuesVisible(v)
      setHideSmallAssets(h)
      setQuickAction(q)
      setSearchTerm('')
      setActiveRowSymbol(null)
    })
  }, [walletHideSmallKey, walletQuickActionKey, walletValuesVisibleKey])

  useEffect(() => {
    window.localStorage.setItem(walletValuesVisibleKey, valuesVisible ? '1' : '0')
  }, [valuesVisible, walletValuesVisibleKey])

  useEffect(() => {
    window.localStorage.setItem(walletHideSmallKey, hideSmallAssets ? '1' : '0')
  }, [hideSmallAssets, walletHideSmallKey])

  useEffect(() => {
    window.localStorage.setItem(walletQuickActionKey, quickAction)
  }, [quickAction, walletQuickActionKey])

  useEffect(() => {
    if (quickSheetOpen && quickAction === 'send') {
      setSendTokenSymbol(NETWORK_CONFIG[network].symbol)
      setSendToAddress('')
      setSendAmount('')
      setSendError(null)
    }
  }, [quickSheetOpen, quickAction, network])

  useEffect(() => {
    const loadHoldings = async () => {
      if (!address || !provider || !isSupportedSwapNetwork(network)) {
        setHoldings([])
        return
      }

      const result = await readTrackedTokenBalances(provider, address, network)
      setHoldings(result as Holding[])
    }

    void loadHoldings()
  }, [address, provider, network, refreshNonce])

  const totalUsd = useMemo(() => {
    const nativePrice = getPrice(symbol, network)
    let sum = (Number(balance ?? '0') || 0) * (nativePrice || 0)
    for (const h of holdings) {
      const p = getPrice(h.symbol, network)
      sum += (Number(h.amount || '0') || 0) * (p || 0)
    }
    return sum
  }, [balance, getPrice, holdings, network, symbol])
  const chainInfo = useMemo(() => getChainInfo(network), [network])

  const rows: WalletRow[] = useMemo(() => {
    if (!address) {
      return []
    }

    const nativePrice = getPrice(symbol, network)
    const nativeRow: WalletRow[] = [{
      symbol,
      subtitle: nativePrice ? `$${nativePrice >= 1 ? nativePrice.toFixed(2) : nativePrice.toFixed(4)}` : '—',
      amount: balance ? Number(balance).toFixed(4) : '0.0000',
      value: `≈ $${totalUsd.toFixed(2)}`,
      numericValue: totalUsd,
      avatar: symbol[0],
      avatarTone: getAvatarTone(symbol),
      chainBadge: chainInfo.chainBadge,
      chainTone: chainInfo.chainTone,
      tone: 'flat' as const,
    }]

    const holdingRows: WalletRow[] = holdings.map((item) => {
      const price = getPrice(item.symbol, network)
      const numAmount = Number(item.amount || '0')
      const usdValue = price ? numAmount * price : 0
      return {
        symbol: item.symbol,
        subtitle: price ? `$${price >= 1 ? price.toFixed(2) : price.toFixed(4)}` : '—',
        amount: item.amount,
        value: usdValue > 0 ? `≈ $${usdValue >= 1 ? usdValue.toFixed(2) : usdValue.toFixed(4)}` : '—',
        numericValue: usdValue,
        avatar: item.symbol[0],
        avatarTone: getAvatarTone(item.symbol),
        chainBadge: chainInfo.chainBadge,
        chainTone: chainInfo.chainTone,
        tone: 'flat' as const,
      }
    })

    return [...nativeRow, ...holdingRows]
  }, [address, balance, chainInfo.chainBadge, chainInfo.chainTone, getPrice, holdings, network, symbol, totalUsd])

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return rows.filter((item) => {
      const matchesQuery = !query || item.symbol.toLowerCase().includes(query) || item.subtitle.toLowerCase().includes(query)
      const matchesValue = !hideSmallAssets || item.numericValue >= 1
      return matchesQuery && matchesValue
    })
  }, [hideSmallAssets, rows, searchTerm])

  const activeRow = activeRowSymbol ? rows.find((item) => item.symbol === activeRowSymbol) ?? null : null
  const quickSheetMeta = {
    receive: { title: '收款', desc: '', primary: '', secondary: '' },
    send: { title: '转账', desc: '', primary: '', secondary: '' },
    scan: { title: '扫码', desc: '复制地址后分享', primary: '复制', secondary: '关闭' },
    bridge: { title: '跨链', desc: '切换网络', primary: '切换', secondary: '关闭' },
  } satisfies Record<WalletQuickAction, { title: string; desc: string; primary: string; secondary: string }>

  const handleCopyAddress = async () => {
    if (!address || !navigator.clipboard) return
    await navigator.clipboard.writeText(address)
    setCopiedAddress(true)
    window.setTimeout(() => setCopiedAddress(false), 1200)
  }

  const flashPanelNotice = (message: string) => {
    setPanelNotice(message)
    window.setTimeout(() => {
      setPanelNotice((current) => (current === message ? null : current))
    }, 1400)
  }

  const handleSendTransfer = async () => {
    if (!signer || !address || !isSupportedSwapNetwork(network)) {
      setSendError('当前网络暂不支持转账')
      return
    }
    const to = sendToAddress.trim()
    if (!ethers.isAddress(to)) {
      setSendError('请输入有效的收款地址')
      return
    }
    const amount = sendAmount.trim()
    if (!amount || Number(amount) <= 0) {
      setSendError('请输入转账金额')
      return
    }
    setSendError(null)
    setSendLoading(true)
    try {
      const token = getTokenBySymbol(network, sendTokenSymbol)
      if (!token) {
        setSendError(`未找到代币 ${sendTokenSymbol}`)
        return
      }
      if (token.isNative) {
        const tx = await signer.sendTransaction({
          to,
          value: ethers.parseEther(amount),
        })
        await tx.wait()
      } else {
        const contract = new ethers.Contract(token.address, ERC20_ABI, signer)
        const amountWei = ethers.parseUnits(amount, token.decimals)
        const tx = await contract.transfer(to, amountWei)
        await tx.wait()
      }
      flashPanelNotice('转账成功')
      setQuickSheetOpen(false)
      void refreshBalance()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) {
        setSendError('已取消签名')
      } else if (msg.toLowerCase().includes('insufficient')) {
        setSendError('余额不足')
      } else {
        setSendError('转账失败，请重试')
      }
    } finally {
      setSendLoading(false)
    }
  }

  const quickActions = [
    { label: '收款', kind: 'receive' as const },
    { label: '转账', kind: 'send' as const },
  ]

  return (
    <div className="page ave-page ave-wallet-shell-page">
      <div className="wallet-unified-card">
      <div className="wallet-hero-card">
        <div className="wallet-balance-block">
          <div className="wallet-balance-label">总资产</div>
          <div className={`wallet-total-value ${isObserveWallet ? 'wallet-total-value-observe' : ''}`}>
            {isObserveWallet ? '—' : valuesVisible ? `$${totalUsd > 0 ? totalUsd.toFixed(2) : '0.00'}` : '••••'}
            {!isObserveWallet && (
              <button type="button" className="wallet-total-eye" onClick={() => setValuesVisible((v) => !v)} aria-label="切换显示">
                {valuesVisible ? '◔' : '◕'}
              </button>
            )}
          </div>
          <div className="wallet-address-line">
            {address ? (
              <button type="button" className="wallet-address-btn" onClick={() => void handleCopyAddress()}>
                <span className="wallet-address-short">{`${address.slice(0, 6)}...${address.slice(-4)}`}</span>
                <span className="wallet-address-copy-icon">复制</span>
              </button>
            ) : (
              <button type="button" className="wallet-address-create" onClick={() => setShowSetup(true)}>创建钱包</button>
            )}
          </div>
        </div>

        <div className="wallet-quick-row">
          {quickActions.map((item) => (
            <button
              key={item.label}
              type="button"
              className="wallet-quick-item"
              onClick={() => {
                setQuickAction(item.kind)
                setQuickSheetOpen(true)
              }}
            >
              <span className={`wallet-quick-icon wallet-quick-icon-${item.kind}`}>
                <WalletQuickIcon kind={item.kind} />
              </span>
              <span className="wallet-quick-label">{item.label}</span>
            </button>
          ))}
        </div>
        {copiedAddress && <div className="wallet-inline-notice">地址已复制</div>}
        {panelNotice && <div className="wallet-inline-notice">{panelNotice}</div>}
      </div>

      <div className="wallet-assets-section">
        <div className="wallet-assets-header">
          <span className="wallet-assets-title">资产</span>
          <div className="wallet-assets-actions">
            <button type="button" className={`wallet-filter-btn ${hideSmallAssets ? 'active' : ''}`} onClick={() => setHideSmallAssets((v) => !v)}>
              隐藏小额
            </button>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="wallet-search-input"
              placeholder="搜索"
            />
          </div>
        </div>

      <div className="wallet-token-feed">
        {filteredRows.map((item) => (
          <div key={item.symbol}>
            <button type="button" className="wallet-token-row" onClick={() => setActiveRowSymbol(item.symbol)}>
              <div className="wallet-token-main">
                  <span className={`wallet-token-avatar wallet-token-avatar-${item.avatarTone}`}>
                  {item.avatar}
                    <span className={`wallet-token-chain-badge wallet-token-chain-badge-${item.chainTone}`}>{item.chainBadge}</span>
                </span>
                <div>
                  <div className="wallet-token-name">{item.symbol}</div>
                  <div className={`wallet-token-sub wallet-token-sub-${item.tone}`}>{item.subtitle}</div>
                </div>
              </div>
              <div className="wallet-token-side">
                <div className="wallet-token-amount">{!isObserveWallet && valuesVisible ? item.amount : '••••'}</div>
                <div className="wallet-token-side-sub">{!isObserveWallet && valuesVisible ? item.value : '金额隐藏'}</div>
              </div>
              <span className="wallet-token-chevron" aria-hidden="true">›</span>
            </button>
          </div>
        ))}
        {filteredRows.length === 0 && (
          <div className="wallet-empty-state">暂无资产</div>
        )}
      </div>
      </div>

      {!address && (
        <div className="wallet-setup-toggle-wrap">
          <button
            type="button"
            className="wallet-setup-toggle"
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? '收起导入钱包' : '创建/导入钱包'}
          </button>
          {showSetup && (
            <div className="wallet-setup-inline">
              <button type="button" className="btn-primary" onClick={() => void createWallet()} disabled={connecting}>
                {connecting ? '处理中…' : '创建钱包'}
              </button>
              <textarea
                rows={3}
                placeholder="输入助记词后点导入"
                value={importMnemonic}
                onChange={(e) => setImportMnemonic(e.target.value)}
              />
              <button type="button" className="btn-ghost" onClick={() => void importWallet(importMnemonic)} disabled={connecting}>
                导入钱包
              </button>
            </div>
          )}
        </div>
      )}

      </div>

      {activeRow && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setActiveRowSymbol(null)} aria-label="关闭资产详情" />
          <div className="swap-token-picker-sheet">
            <div className="swap-token-picker-handle" />
            <div className="swap-token-picker-head">
              <div className="swap-token-picker-title">{activeRow.symbol}</div>
              <div className="swap-token-picker-sub">{NETWORK_CONFIG[network].chainName} · 资产详情</div>
            </div>
            <div className="wallet-detail-card">
              <div className="wallet-detail-top">
                <span className={`wallet-token-avatar wallet-token-avatar-${activeRow.avatarTone} wallet-detail-avatar`}>
                  {activeRow.avatar}
                  <span className={`wallet-token-chain-badge wallet-token-chain-badge-${activeRow.chainTone}`}>{activeRow.chainBadge}</span>
                </span>
                <div className="wallet-detail-copy">
                  <div className="wallet-detail-title">{activeRow.symbol}</div>
                  <div className={`wallet-detail-sub wallet-token-sub-${activeRow.tone}`}>{activeRow.subtitle}</div>
                </div>
                <div className="wallet-detail-side">
                  <div className="wallet-detail-amount">{isObserveWallet ? '••••' : activeRow.amount}</div>
                  <div className="wallet-detail-value">{isObserveWallet ? '金额隐藏' : activeRow.value}</div>
                </div>
              </div>
            </div>
            <div className="swap-info-list">
              <div className="swap-info-item">
                <div className="swap-info-label">持仓数量</div>
                <div className="swap-info-value">{isObserveWallet ? '••••' : activeRow.amount}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">估值</div>
                <div className="swap-info-value">{isObserveWallet ? '金额隐藏' : activeRow.value}</div>
              </div>
              <div className="swap-info-item">
                <div className="swap-info-label">价格信息</div>
                <div className={`swap-info-value ${activeRow.tone === 'up' ? 'swap-info-value-success' : activeRow.tone === 'down' ? 'swap-info-value-failed' : ''}`}>
                  {activeRow.subtitle}
                </div>
              </div>
            </div>
            <div className="swap-sheet-actions">
              <button type="button" className="swap-sheet-secondary" onClick={() => {
                setQuickAction('receive')
                setActiveRowSymbol(null)
              }}>
                收款
              </button>
              <button type="button" className="swap-sheet-primary" onClick={() => {
                setQuickAction('send')
                setActiveRowSymbol(null)
              }}>
                转账
              </button>
            </div>
          </div>
        </>
      )}

      {quickSheetOpen && (
        <>
          <button type="button" className="swap-token-picker-backdrop" onClick={() => setQuickSheetOpen(false)} aria-label="关闭" />
          <div className="wallet-action-sheet">
            <div className="wallet-action-sheet-handle" />
            <div className="wallet-action-sheet-head">
              <span className="wallet-action-sheet-title">{quickSheetMeta[quickAction].title}</span>
              <span className="wallet-action-sheet-sub">{NETWORK_CONFIG[network].chainName}</span>
            </div>

            {quickAction === 'receive' && (
              <div className="wallet-receive-sheet">
                {address ? (
                  <>
                    <div className="wallet-receive-qr-wrap">
                      <QRCodeSVG value={address} size={180} level="M" includeMargin />
                    </div>
                    <div className="wallet-receive-address">{address}</div>
                    <button type="button" className="wallet-receive-copy-btn" onClick={() => void handleCopyAddress().then(() => flashPanelNotice('已复制'))}>
                      复制地址
                    </button>
                  </>
                ) : (
                  <div className="wallet-action-sheet-empty">请先创建或导入钱包</div>
                )}
              </div>
            )}

            {quickAction === 'send' && (
              <div className="wallet-send-sheet">
                {address && isSupportedSwapNetwork(network) ? (
                  <>
                    <div className="wallet-send-token-row">
                      <span className="wallet-send-token-label">币种</span>
                      <select value={sendTokenSymbol} onChange={(e) => setSendTokenSymbol(e.target.value)} className="wallet-send-token-select">
                        {getSwapTokens(network).map((t) => (
                          <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                        ))}
                      </select>
                    </div>
                    <div className="wallet-send-input-wrap">
                      <input
                        type="text"
                        value={sendToAddress}
                        onChange={(e) => setSendToAddress(e.target.value)}
                        placeholder="收款地址 0x..."
                        className="wallet-send-input"
                      />
                    </div>
                    <div className="wallet-send-input-wrap">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={sendAmount}
                        onChange={(e) => setSendAmount(e.target.value)}
                        placeholder="金额"
                        className="wallet-send-input"
                      />
                    </div>
                    {sendError && <div className="wallet-send-error">{sendError}</div>}
                    <button type="button" className="wallet-send-submit" onClick={() => void handleSendTransfer()} disabled={sendLoading}>
                      {sendLoading ? '处理中…' : '确认转账'}
                    </button>
                  </>
                ) : (
                  <div className="wallet-action-sheet-empty">
                    {!address ? '请先创建或导入钱包' : '当前网络暂不支持'}
                  </div>
                )}
              </div>
            )}

            {quickAction !== 'receive' && quickAction !== 'send' && (
              <div className="wallet-action-sheet-empty">
                {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : '请先创建或导入钱包'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
