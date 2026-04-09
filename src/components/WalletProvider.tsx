import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { readNativeBalance } from '../lib/evm/balances'
import { NETWORK_CONFIG, type Network } from '../lib/walletConfig'

interface WalletContextValue {
  provider: ethers.JsonRpcProvider | null
  signer: ethers.HDNodeWallet | null
  address: string | null
  network: Network
  chainId: number | null
  balance: string | null
  connecting: boolean
  refreshNonce: number
  createWallet: () => Promise<void>
  importWallet: (mnemonic: string) => Promise<void>
  switchNetwork: (network: Network) => Promise<void>
  refreshBalance: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

const STORAGE_KEY = 'internal_evm_mnemonic_v1'

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
    wallet,
    address,
    balance: ethers.formatEther(raw),
    chainId: NETWORK_CONFIG[network].chainId,
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null)
  const [signer, setSigner] = useState<ethers.HDNodeWallet | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [network, setNetwork] = useState<Network>('mainnet')
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [mnemonicModal, setMnemonicModal] = useState<{ phrase: string; revealed: boolean } | null>(null)

  const loadFromStorage = async (targetNetwork: Network) => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    const built = await buildWalletForMnemonic(saved, targetNetwork)
    setProvider(built.provider)
    setSigner(built.wallet)
    setAddress(built.address)
    setBalance(built.balance)
    setChainId(built.chainId)
    setNetwork(targetNetwork)
    setRefreshNonce((current) => current + 1)
  }

  useEffect(() => {
    void loadFromStorage('mainnet')
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
      const evmNetwork = network
      const built = await buildWalletForMnemonic(mnemonic, evmNetwork)
      setProvider(built.provider)
      setSigner(built.wallet)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(evmNetwork)
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
      const evmNetwork = network
      const built = await buildWalletForMnemonic(phrase, evmNetwork)
      setProvider(built.provider)
      setSigner(built.wallet)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(evmNetwork)
      setRefreshNonce((current) => current + 1)
    } catch (e) {
      console.error('Import wallet error', e)
      alert('导入失败，请检查助记词是否正确（12 或 24 个英文单词）。')
    } finally {
      setConnecting(false)
    }
  }, [network])

  const switchNetwork = useCallback(async (target: Network) => {
    if (target === 'polygon') target = 'mainnet'
    const mnemonic = localStorage.getItem(STORAGE_KEY)
    if (!mnemonic) {
      setNetwork(target)
      setProvider(null)
      setSigner(null)
      setAddress(null)
      setBalance(null)
      setChainId(null)
      setRefreshNonce((current) => current + 1)
      return
    }
    try {
      const built = await buildWalletForMnemonic(mnemonic, target)
      setProvider(built.provider)
      setSigner(built.wallet)
      setAddress(built.address)
      setBalance(built.balance)
      setChainId(built.chainId)
      setNetwork(target)
      setRefreshNonce((current) => current + 1)
    } catch (e) {
      console.error('Switch network error', e)
      alert('切换网络失败，请稍后再试。')
    }
  }, [])

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
      createWallet,
      importWallet,
      switchNetwork,
      refreshBalance,
    }),
    [provider, signer, address, network, chainId, balance, connecting, refreshNonce, createWallet, importWallet, switchNetwork, refreshBalance],
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
