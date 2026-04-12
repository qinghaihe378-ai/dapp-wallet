import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { readNativeBalance } from '../lib/evm/balances'
import { NETWORK_CONFIG, type Network } from '../lib/walletConfig'

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: any[]) => void) => void
  removeListener?: (event: string, handler: (...args: any[]) => void) => void
  selectedAddress?: string | null
  chainId?: string
  providers?: Eip1193Provider[]
}

interface WalletContextValue {
  provider: ethers.Provider | null
  signer: ethers.Signer | null
  address: string | null
  network: Network
  chainId: number | null
  balance: string | null
  connecting: boolean
  refreshNonce: number
  walletType: 'none' | 'internal' | 'injected'
  canUseInjected: boolean
  connectInjected: () => Promise<void>
  createWallet: () => Promise<void>
  importWallet: (mnemonic: string) => Promise<void>
  disconnect: () => Promise<void>
  switchNetwork: (network: Network) => Promise<void>
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

const STORAGE_KEY = 'internal_evm_mnemonic_v1'
const PREFERRED_WALLET_KEY = 'wallet_preferred_type_v1'

function getInjectedEthereum(): Eip1193Provider | null {
  const anyWindow = window as unknown as { ethereum?: Eip1193Provider }
  if (!anyWindow?.ethereum?.request) return null
  const eth = anyWindow.ethereum
  const list = Array.isArray(eth.providers) ? eth.providers : null
  if (list && list.length > 0) {
    const first = list.find((p) => p?.request) ?? null
    if (first) return first
  }
  return eth
}

function resolveNetworkByChainId(chainId: number): Network | null {
  const entries = Object.entries(NETWORK_CONFIG) as Array<[Network, (typeof NETWORK_CONFIG)[Network]]>
  for (const [name, cfg] of entries) {
    if (cfg.chainId === chainId) return name
  }
  return null
}

function buildProvider(network: Network) {
  const rpc = NETWORK_CONFIG[network].rpcUrls[0]
  return new ethers.JsonRpcProvider(rpc)
}

async function buildWalletForMnemonic(mnemonic: string, network: Network) {
  const provider = buildProvider(network)
  const wallet = ethers.Wallet.fromPhrase(mnemonic).connect(provider)
  const address = await wallet.getAddress()
  const raw = await provider.getBalance(address)
  return {
    provider,
    signer: wallet,
    address,
    balance: ethers.formatEther(raw),
    chainId: NETWORK_CONFIG[network].chainId,
    network,
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ethers.Provider | null>(null)
  const [signer, setSigner] = useState<ethers.Signer | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [network, setNetwork] = useState<Network>('bsc')
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [mnemonicModal, setMnemonicModal] = useState<{ phrase: string; revealed: boolean } | null>(null)
  const [walletType, setWalletType] = useState<'none' | 'internal' | 'injected'>('none')
  const [canUseInjected, setCanUseInjected] = useState(false)
  const networkRef = useRef<Network>('bsc')
  networkRef.current = network

  const loadFromStorage = async (targetNetwork: Network) => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    const built = await buildWalletForMnemonic(saved, targetNetwork)
    setProvider(built.provider)
    setSigner(built.signer)
    setAddress(built.address)
    setBalance(built.balance)
    setChainId(built.chainId)
    setNetwork(targetNetwork)
    setWalletType('internal')
    setRefreshNonce((current) => current + 1)
  }

  const connectInjectedSilently = useCallback(
    async (eth: Eip1193Provider, address: string) => {
      const chainHex = await eth.request({ method: 'eth_chainId' })
      const chainIdNum = typeof chainHex === 'string' ? Number(BigInt(chainHex)) : NaN
      const resolved = Number.isFinite(chainIdNum) ? resolveNetworkByChainId(chainIdNum) : null
      if (!resolved) {
        await loadFromStorage('bsc')
        return
      }
      const browserProvider = new ethers.BrowserProvider(eth)
      const signer = await browserProvider.getSigner()
      const raw = await browserProvider.getBalance(address)
      setProvider(browserProvider)
      setSigner(signer)
      setAddress(address)
      setBalance(ethers.formatEther(raw))
      setChainId(chainIdNum)
      setNetwork(resolved === 'polygon' ? 'mainnet' : resolved)
      setWalletType('injected')
      setRefreshNonce((current) => current + 1)
    },
    [],
  )

  useEffect(() => {
    const eth = getInjectedEthereum()
    setCanUseInjected(Boolean(eth))

    let cancelled = false

    const boot = async () => {
      if (eth) {
        try {
          const preferred = localStorage.getItem(PREFERRED_WALLET_KEY)
          let accounts = await eth.request({ method: 'eth_accounts' })
          if (cancelled) return
          const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
          const first = typeof list[0] === 'string' ? (list[0] as string) : null
          const selected = (eth.selectedAddress && String(eth.selectedAddress)) || null
          const existing = first || selected
          if (existing) {
            await connectInjectedSilently(eth, existing)
            return
          }
          if (preferred === 'injected') {
            try {
              accounts = await eth.request({ method: 'eth_requestAccounts' })
              if (cancelled) return
              const reqList = Array.isArray(accounts) ? (accounts as unknown[]) : []
              const reqFirst = typeof reqList[0] === 'string' ? (reqList[0] as string) : null
              if (reqFirst) {
                await connectInjectedSilently(eth, reqFirst)
                return
              }
            } catch {
            }
          }
        } catch {
        }
      }
      await loadFromStorage('bsc')
    }

    void boot()

    const handleAccountsChanged = (accounts: unknown) => {
      if (cancelled) return
      const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
      const first = typeof list[0] === 'string' ? (list[0] as string) : null
      if (!first) {
        setProvider(null)
        setSigner(null)
        setAddress(null)
        setBalance(null)
        setChainId(null)
        setWalletType('none')
        setRefreshNonce((current) => current + 1)
        void loadFromStorage(networkRef.current)
        return
      }
      if (!eth) return
      void (async () => {
        try {
          await connectInjectedSilently(eth, first)
        } catch {
        }
      })()
    }

    const handleChainChanged = () => {
      if (cancelled) return
      if (!eth) return
      void (async () => {
        try {
          const accounts = await eth.request({ method: 'eth_accounts' })
          const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
          const first = typeof list[0] === 'string' ? (list[0] as string) : null
          if (!first) return
          await connectInjectedSilently(eth, first)
        } catch {
        }
      })()
    }

    if (eth?.on && eth?.removeListener) {
      eth.on('accountsChanged', handleAccountsChanged)
      eth.on('chainChanged', handleChainChanged)
    }

    return () => {
      cancelled = true
      if (eth?.removeListener) {
        eth.removeListener('accountsChanged', handleAccountsChanged)
        eth.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [])

  useEffect(() => {
    if (canUseInjected) return

    let cancelled = false
    let tries = 0
    const interval = window.setInterval(() => {
      if (cancelled) return
      tries += 1
      const eth = getInjectedEthereum()
      if (eth) {
        setCanUseInjected(true)
        void (async () => {
          try {
            if (walletType === 'injected' || address) return
            const accounts = await eth.request({ method: 'eth_accounts' })
            const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
            const first = typeof list[0] === 'string' ? (list[0] as string) : null
            const selected = (eth.selectedAddress && String(eth.selectedAddress)) || null
            const existing = first || selected
            if (existing) {
              await connectInjectedSilently(eth, existing)
            }
          } catch {
          }
        })()
        window.clearInterval(interval)
        return
      }
      if (tries >= 20) {
        window.clearInterval(interval)
      }
    }, 500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [address, canUseInjected, connectInjectedSilently, walletType])

  const connectInjected = useCallback(async () => {
    const eth = getInjectedEthereum()
    if (!eth) {
      alert('未检测到内置钱包。')
      return
    }
    try {
      setConnecting(true)
      const accounts = await eth.request({ method: 'eth_requestAccounts' })
      const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
      const first = typeof list[0] === 'string' ? (list[0] as string) : null
      if (!first) {
        alert('连接失败，请重试。')
        return
      }
      localStorage.setItem(PREFERRED_WALLET_KEY, 'injected')
      await connectInjectedSilently(eth, first)
      setRefreshNonce((current) => current + 1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) {
        alert('已取消连接')
      } else {
        alert('连接失败，请重试。')
      }
    } finally {
      setConnecting(false)
    }
  }, [])

  const createWallet = useCallback(async () => {
    try {
      setConnecting(true)
      const wallet = ethers.Wallet.createRandom()
      const mnemonic = wallet.mnemonic?.phrase ?? ''
      if (!mnemonic) {
        alert('创建失败，请重试。')
        return
      }
      localStorage.setItem(STORAGE_KEY, mnemonic)
      localStorage.setItem(PREFERRED_WALLET_KEY, 'internal')
      const evmNetwork = network
      const built = await buildWalletForMnemonic(mnemonic, evmNetwork)
      setProvider(built.provider)
      setSigner(built.signer)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(evmNetwork)
      setWalletType('internal')
      setRefreshNonce((current) => current + 1)
      setMnemonicModal({ phrase: mnemonic, revealed: false })
    } catch (e) {
      console.error('Create wallet error', e)
      alert('创建钱包失败，请重试。')
    } finally {
      setConnecting(false)
    }
  }, [network])

  const importWallet = useCallback(async (mnemonic: string) => {
    const phrase = mnemonic.trim()
    if (!phrase) {
      alert('请输入助记词。')
      return
    }
    try {
      setConnecting(true)
      ethers.Wallet.fromPhrase(phrase) // 校验格式
      localStorage.setItem(STORAGE_KEY, phrase)
      localStorage.setItem(PREFERRED_WALLET_KEY, 'internal')
      const evmNetwork = network
      const built = await buildWalletForMnemonic(phrase, evmNetwork)
      setProvider(built.provider)
      setSigner(built.signer)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(evmNetwork)
      setWalletType('internal')
      setRefreshNonce((current) => current + 1)
    } catch (e) {
      console.error('Import wallet error', e)
      alert('导入失败，请检查助记词是否正确（12 或 24 个英文单词）。')
    } finally {
      setConnecting(false)
    }
  }, [network])

  const disconnect = useCallback(async () => {
    setProvider(null)
    setSigner(null)
    setAddress(null)
    setBalance(null)
    setChainId(null)
    setWalletType('none')
    setRefreshNonce((current) => current + 1)
  }, [])

  const switchNetwork = useCallback(async (target: Network) => {
    if (target === 'polygon') target = 'mainnet'
    const eth = getInjectedEthereum()
    if (walletType === 'injected' && eth) {
      try {
        setConnecting(true)
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${NETWORK_CONFIG[target].chainId.toString(16)}` }],
        })
        const accounts = await eth.request({ method: 'eth_accounts' })
        const list = Array.isArray(accounts) ? (accounts as unknown[]) : []
        const first = typeof list[0] === 'string' ? (list[0] as string) : null
        if (!first) return
        const browserProvider = new ethers.BrowserProvider(eth)
        const signer = await browserProvider.getSigner(first)
        const raw = await browserProvider.getBalance(first)
        setProvider(browserProvider)
        setSigner(signer)
        setAddress(first)
        setBalance(ethers.formatEther(raw))
        setChainId(NETWORK_CONFIG[target].chainId)
        setNetwork(target)
        setWalletType('injected')
        setRefreshNonce((current) => current + 1)
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('ACTION_REJECTED') || msg.toLowerCase().includes('user rejected')) {
          alert('已取消切换网络')
        } else {
          alert('切换网络失败，请稍后再试。')
        }
        return
      } finally {
        setConnecting(false)
      }
    }

    const mnemonic = localStorage.getItem(STORAGE_KEY)
    if (!mnemonic) {
      setNetwork(target)
      setProvider(null)
      setSigner(null)
      setAddress(null)
      setBalance(null)
      setChainId(null)
      setWalletType('none')
      setRefreshNonce((current) => current + 1)
      return
    }
    try {
      const built = await buildWalletForMnemonic(mnemonic, target)
      setProvider(built.provider)
      setSigner(built.signer)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(target)
      setWalletType('internal')
      setRefreshNonce((current) => current + 1)
    } catch (e) {
      console.error('Switch network error', e)
      alert('切换网络失败，请稍后再试。')
    }
  }, [walletType])

  const refreshBalance = useCallback(async () => {
    if (!provider || !address) {
      return
    }
    try {
      const nextBalance = await readNativeBalance(provider, address)
      setBalance(nextBalance)
      setRefreshNonce((current) => current + 1)
    } catch (error) {
      console.error('Refresh balance error', error)
    }
  }, [provider, address, network])

  const value = useMemo(
    () => ({
      provider,
      signer,
      address,
      network,
      chainId,
      balance,
      connecting,
      refreshNonce,
      walletType,
      canUseInjected,
      connectInjected,
      createWallet,
      importWallet,
      disconnect,
      switchNetwork,
      refreshBalance,
    }),
    [provider, signer, address, network, chainId, balance, connecting, refreshNonce, walletType, canUseInjected, connectInjected, createWallet, importWallet, disconnect, switchNetwork, refreshBalance],
  )

  const copyMnemonic = async () => {
    if (!mnemonicModal?.phrase || !navigator.clipboard) return
    await navigator.clipboard.writeText(mnemonicModal.phrase)
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
      {mnemonicModal && (
        <div className="mnemonic-modal-backdrop" onClick={() => setMnemonicModal(null)} role="presentation">
          <div className="mnemonic-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="助记词备份">
            <div className="mnemonic-modal-title">请妥善保存助记词</div>
            <p className="mnemonic-modal-warn">切勿泄露给他人，否则将导致资产丢失。</p>
            {mnemonicModal.revealed ? (
              <div className="mnemonic-modal-phrase">{mnemonicModal.phrase}</div>
            ) : (
              <button type="button" className="btn-ghost mnemonic-modal-reveal" onClick={() => setMnemonicModal((m) => m && { ...m, revealed: true })}>
                点击显示助记词
              </button>
            )}
            <div className="mnemonic-modal-actions">
              {mnemonicModal.revealed && (
                <button type="button" className="btn-primary" onClick={() => void copyMnemonic()}>
                  复制
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => setMnemonicModal(null)}>
                已保存
              </button>
            </div>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- useWallet is the standard hook for this context
export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used inside WalletProvider')
  }
  return ctx
}
