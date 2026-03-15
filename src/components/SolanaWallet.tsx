import { useEffect, useState } from 'react'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import { NETWORK_CONFIG } from '../lib/walletConfig'

const RPC_ENDPOINT = NETWORK_CONFIG.solana.rpcUrls[0]
const STORAGE_KEY = 'internal_solana_secret_v1'

interface SolanaState {
  address: string | null
  balance: number | null
}

export function SolanaWallet() {
  const [state, setState] = useState<SolanaState>({
    address: null,
    balance: null,
  })
  const [keypair, setKeypair] = useState<Keypair | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [secretInput, setSecretInput] = useState('')
  const [secretModal, setSecretModal] = useState<{ secret: string; revealed: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'receive' | 'send'>('receive')

  const loadBalance = async (address: string) => {
    try {
      const conn = new Connection(RPC_ENDPOINT)
      const pubkey = new PublicKey(address)
      const lamports = await conn.getBalance(pubkey)
      setState((s) => ({ ...s, balance: lamports / LAMPORTS_PER_SOL }))
    } catch (e) {
      console.error(e)
      setState((s) => ({ ...s, balance: null }))
    }
  }

  const createWallet = () => {
    const kp = Keypair.generate()
    setKeypair(kp)
    const addr = kp.publicKey.toString()
    setState({ address: addr, balance: null })
    const serialized = JSON.stringify(Array.from(kp.secretKey))
    localStorage.setItem(STORAGE_KEY, serialized)
    setSecretModal({ secret: serialized, revealed: false })
    setNotice('已创建新的 Solana 钱包，请立即备份 secretKey。')
    setError(null)
    void loadBalance(addr)
  }

  const importWallet = () => {
    if (!secretInput.trim()) {
      setError('请输入 secretKey 数组。')
      return
    }
    try {
      const arr: number[] = JSON.parse(secretInput)
      const secret = Uint8Array.from(arr)
      const kp = Keypair.fromSecretKey(secret)
      setKeypair(kp)
      const addr = kp.publicKey.toString()
      setState({ address: addr, balance: null })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
      setNotice('Solana 钱包已导入。')
      setSecretInput('')
      setError(null)
      void loadBalance(addr)
    } catch (e) {
      console.error(e)
      setError('导入失败，secretKey 格式不正确。')
    }
  }

  const send = async () => {
    setError(null)
    setTxHash(null)
    if (!keypair || !state.address) {
      setError('请先创建或导入 Solana 钱包。')
      return
    }
    if (!to || !amount) return
    try {
      setLoading(true)
      const conn = new Connection(RPC_ENDPOINT)
      const fromPubkey = keypair.publicKey
      const toPubkey = new PublicKey(to)
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: Number(amount) * LAMPORTS_PER_SOL,
        }),
      )
      tx.feePayer = fromPubkey
      const { blockhash } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      const signed = await conn.sendTransaction(tx, [keypair])
      setTxHash(signed)
      await loadBalance(state.address)
    } catch (e) {
      console.error(e)
      setError('发送 SOL 失败，请检查地址和网络。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const arr: number[] = JSON.parse(saved)
      const secret = Uint8Array.from(arr)
      const kp = Keypair.fromSecretKey(secret)
      setKeypair(kp)
      const addr = kp.publicKey.toString()
      setState({ address: addr, balance: null })
      void loadBalance(addr)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const copyAddress = async () => {
    if (!state.address || !navigator.clipboard) return
    await navigator.clipboard.writeText(state.address)
    setCopied(true)
    setNotice('Solana 地址已复制。')
    window.setTimeout(() => setCopied(false), 1200)
  }

  const copySecret = async () => {
    if (!secretModal?.secret || !navigator.clipboard) return
    await navigator.clipboard.writeText(secretModal.secret)
    setNotice('secretKey 已复制，请妥善保存。')
  }

  return (
    <div className="solana-wallet solana-wallet-compact">
      <div className="solana-head-row">
        <span className="solana-title">Solana</span>
        {state.address && (
          <button type="button" className="solana-refresh-btn" onClick={() => state.address && void loadBalance(state.address)}>刷新</button>
        )}
      </div>
      {!state.address ? (
        <div className="wallet-setup-card solana-setup-compact">
          <div className="solana-inline-actions">
            <button type="button" className="btn-primary" onClick={() => void createWallet()}>创建钱包</button>
            <button type="button" className="btn-ghost" onClick={() => void importWallet()}>导入</button>
          </div>
          <textarea
            rows={2}
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="secretKey 数组 [12,34,...]"
            className="solana-secret-input"
          />
          {notice && <p className="solana-notice success">{notice}</p>}
          {error && <p className="solana-notice error">{error}</p>}
        </div>
      ) : (
        <div className="wallet-form-card solana-form-compact">
          <div className="solana-summary-row">
            <div className="solana-summary-main">
              <span className="solana-address-short">{state.address ? `${state.address.slice(0, 8)}...${state.address.slice(-6)}` : ''}</span>
              <span className="solana-balance">{state.balance !== null ? state.balance.toFixed(4) : '0.0000'} SOL</span>
            </div>
            <div className="solana-mode-row">
              <button type="button" className={`solana-mode-chip ${mode === 'receive' ? 'active' : ''}`} onClick={() => setMode('receive')}>收款</button>
              <button type="button" className={`solana-mode-chip ${mode === 'send' ? 'active' : ''}`} onClick={() => setMode('send')}>转账</button>
              <button type="button" className="solana-mode-chip" onClick={() => void copyAddress()}>{copied ? '已复制' : '复制'}</button>
            </div>
          </div>
          {notice && <p className="solana-notice success">{notice}</p>}
          {mode === 'send' && (
            <div className="solana-send-form">
              <div className="solana-form-row">
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="接收地址" className="solana-input" />
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金额" className="solana-input solana-input-amount" />
              </div>
              <button type="button" className="btn-primary solana-send-btn" disabled={loading} onClick={() => void send()}>
                {loading ? '发送中…' : '发送 SOL'}
              </button>
              {error && <p className="solana-notice error">{error}</p>}
              {txHash && <p className="solana-notice success">已发送：{txHash.slice(0, 12)}...</p>}
            </div>
          )}
        </div>
      )}

      {secretModal && (
        <div className="mnemonic-modal-backdrop" onClick={() => setSecretModal(null)} role="presentation">
          <div className="mnemonic-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="secretKey 备份">
            <div className="mnemonic-modal-title">请妥善保存 secretKey</div>
            <p className="mnemonic-modal-warn">切勿泄露给他人，否则将导致资产丢失。</p>
            {secretModal.revealed ? (
              <div className="mnemonic-modal-phrase solana-secret-modal">{secretModal.secret}</div>
            ) : (
              <button type="button" className="btn-ghost mnemonic-modal-reveal" onClick={() => setSecretModal((m) => m && { ...m, revealed: true })}>
                点击显示 secretKey
              </button>
            )}
            <div className="mnemonic-modal-actions">
              {secretModal.revealed && (
                <button type="button" className="btn-primary" onClick={() => void copySecret()}>
                  复制
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => setSecretModal(null)}>
                已保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

