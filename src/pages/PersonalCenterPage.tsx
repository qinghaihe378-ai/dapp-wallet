import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../components/WalletProvider'
import { NETWORK_CONFIG } from '../lib/walletConfig'
import { UNISWAP_API_KEY_STORAGE_KEY } from '../api/uniswapTrade'

const PROFILE_NICKNAME_KEY = 'profileNickname'

function getUniswapKeySource(): 'local' | 'env' | '' {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(UNISWAP_API_KEY_STORAGE_KEY)?.trim()
    if (stored) return 'local'
  }
  return import.meta.env.VITE_UNISWAP_API_KEY ? 'env' : ''
}

export function PersonalCenterPage() {
  const { address, network } = useWallet()
  const [nickname, setNickname] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(PROFILE_NICKNAME_KEY) ?? ''
  })
  const [editingNickname, setEditingNickname] = useState(false)
  const [tempNickname, setTempNickname] = useState(nickname)
  const [uniswapKeyMasked, setUniswapKeyMasked] = useState(() => (getUniswapKeySource() ? '••••••••' : ''))
  const [uniswapKeySource, setUniswapKeySource] = useState<'local' | 'env' | ''>(() => getUniswapKeySource())
  const [uniswapKeyFocused, setUniswapKeyFocused] = useState(false)
  const [uniswapKeyEdit, setUniswapKeyEdit] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const src = getUniswapKeySource()
    setUniswapKeyMasked(src ? '••••••••' : '')
    setUniswapKeySource(src)
  }, [])

  const saveNickname = () => {
    const val = tempNickname.trim()
    setNickname(val)
    setEditingNickname(false)
    if (typeof window !== 'undefined') {
      if (val) window.localStorage.setItem(PROFILE_NICKNAME_KEY, val)
      else window.localStorage.removeItem(PROFILE_NICKNAME_KEY)
    }
  }

  const saveUniswapKey = (val: string) => {
    const trimmed = val.trim()
    setUniswapKeyMasked(trimmed ? '••••••••' : '')
    if (typeof window !== 'undefined') {
      if (trimmed) window.localStorage.setItem(UNISWAP_API_KEY_STORAGE_KEY, trimmed)
      else window.localStorage.removeItem(UNISWAP_API_KEY_STORAGE_KEY)
    }
  }

  const displayName = nickname || '未设置昵称'
  const initial = (nickname || 'A').charAt(0).toUpperCase()

  return (
    <div className="page ave-page ave-profile-shell">
      <div className="profile-hero-card">
        <div className="profile-hero-topline">
          <div className="profile-hero-chip">个人中心</div>
          <div className="profile-hero-chip profile-hero-chip-network">{NETWORK_CONFIG[network].symbol}</div>
        </div>

        <div className="profile-avatar-wrap">
          <div className="profile-avatar" aria-hidden="true">{initial}</div>
        </div>
        <div className="profile-name-row">
          {editingNickname ? (
            <div className="profile-name-edit">
              <input
                type="text"
                className="profile-name-input"
                value={tempNickname}
                onChange={(e) => setTempNickname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
                placeholder="输入昵称"
                autoFocus
              />
              <button type="button" className="profile-name-btn" onClick={saveNickname}>保存</button>
              <button type="button" className="profile-name-btn profile-name-btn-cancel" onClick={() => { setEditingNickname(false); setTempNickname(nickname) }}>取消</button>
            </div>
          ) : (
            <>
              <span className="profile-name">{displayName}</span>
              <button type="button" className="profile-name-edit-btn" onClick={() => { setEditingNickname(true); setTempNickname(nickname) }} aria-label="编辑昵称">✎</button>
            </>
          )}
        </div>

        <div className="profile-summary-strip">
          {address && (
            <div className="profile-summary-pill">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
          )}
          <div className="profile-summary-pill">{NETWORK_CONFIG[network].chainName}</div>
        </div>

        <div className="profile-quick-row">
          <Link to="/wallet" className="profile-quick-item">
            <span className="profile-quick-icon">钱包</span>
            <span>我的钱包</span>
          </Link>
          <Link to="/swap" className="profile-quick-item">
            <span className="profile-quick-icon">兑换</span>
            <span>兑换</span>
          </Link>
          <Link to="/market" className="profile-quick-item">
            <span className="profile-quick-icon">行情</span>
            <span>行情</span>
          </Link>
        </div>
      </div>

      <div className="profile-panel">
        <div className="profile-panel-head">
          <div className="profile-panel-title">更多</div>
        </div>
        <div className="profile-menu-stack">
          <Link to="/wallet" className="profile-menu-row">
            <span className="profile-menu-icon">钱包</span>
            <span className="profile-menu-label">钱包管理</span>
            <span className="profile-menu-arrow">›</span>
          </Link>
          <Link to="/swap" className="profile-menu-row">
            <span className="profile-menu-icon">交易</span>
            <span className="profile-menu-label">兑换交易</span>
            <span className="profile-menu-arrow">›</span>
          </Link>
          <Link to="/market" className="profile-menu-row">
            <span className="profile-menu-icon">行情</span>
            <span className="profile-menu-label">行情列表</span>
            <span className="profile-menu-arrow">›</span>
          </Link>
          <Link to="/new-tokens" className="profile-menu-row">
            <span className="profile-menu-icon">扫链</span>
            <span className="profile-menu-label">新币雷达</span>
            <span className="profile-menu-arrow">›</span>
          </Link>
        </div>
      </div>

      <div className="profile-panel">
        <div className="profile-panel-head">
          <div className="profile-panel-title">Base Uniswap V4</div>
        </div>
        <div className="profile-panel-body">
          <p className="profile-api-desc">配置后可在 Base 链使用 Uniswap V4 路由（指令交易与兑换页均生效）。</p>
          <div className="profile-api-row">
            <label className="profile-api-label" htmlFor="uniswap-api-key">API Key</label>
            <input
              id="uniswap-api-key"
              type={uniswapKeyFocused ? 'text' : 'password'}
              className="profile-api-input"
              placeholder="未配置"
              value={uniswapKeyFocused ? uniswapKeyEdit : uniswapKeyMasked}
              onChange={(e) => {
                const v = e.target.value
                setUniswapKeyEdit(v)
                setUniswapKeyMasked(v.trim() ? '••••••••' : '')
              }}
              onFocus={() => {
                setUniswapKeyFocused(true)
                const val = typeof window !== 'undefined'
                  ? (window.localStorage.getItem(UNISWAP_API_KEY_STORAGE_KEY) ?? import.meta.env.VITE_UNISWAP_API_KEY ?? '')
                  : ''
                setUniswapKeyEdit(val)
              }}
              onBlur={() => {
                setUniswapKeyFocused(false)
                const v = uniswapKeyEdit.trim()
                if (typeof window !== 'undefined') {
                  if (v) {
                    window.localStorage.setItem(UNISWAP_API_KEY_STORAGE_KEY, v)
                    setUniswapKeyMasked('••••••••')
                  } else {
                    const stored = window.localStorage.getItem(UNISWAP_API_KEY_STORAGE_KEY)
                    setUniswapKeyMasked(stored && stored.trim() ? '••••••••' : '')
                  }
                }
                setUniswapKeyEdit('')
              }}
            />
            <button type="button" className="profile-name-btn profile-api-save" onClick={() => {
              let v = (uniswapKeyFocused ? uniswapKeyEdit : (typeof window !== 'undefined' ? window.localStorage.getItem(UNISWAP_API_KEY_STORAGE_KEY) ?? '' : '')).trim()
              if (!v && typeof window !== 'undefined' && import.meta.env.VITE_UNISWAP_API_KEY) {
                v = String(import.meta.env.VITE_UNISWAP_API_KEY).trim()
              }
              if (typeof window !== 'undefined') {
                if (v) {
                  window.localStorage.setItem(UNISWAP_API_KEY_STORAGE_KEY, v)
                  setUniswapKeyMasked('••••••••')
                  setUniswapKeySource('local')
                } else {
                  window.localStorage.removeItem(UNISWAP_API_KEY_STORAGE_KEY)
                  setUniswapKeyMasked(import.meta.env.VITE_UNISWAP_API_KEY ? '••••••••' : '')
                  setUniswapKeySource(getUniswapKeySource())
                }
              }
              setUniswapKeyFocused(false)
              setUniswapKeyEdit('')
            }}>保存</button>
            {!uniswapKeyMasked && (
              <span className="profile-api-hint">在 <a href="https://developers.uniswap.org/dashboard" target="_blank" rel="noopener noreferrer">Uniswap 开发者平台</a> 获取；或在项目根目录 .env 中配置 VITE_UNISWAP_API_KEY</span>
            )}
            {uniswapKeySource === 'env' && (
              <span className="profile-api-hint">已从 .env 加载</span>
            )}
            {uniswapKeyMasked && (
              <button type="button" className="profile-name-btn profile-api-clear" onClick={() => {
                saveUniswapKey('')
                const src = getUniswapKeySource()
                setUniswapKeyMasked(src ? '••••••••' : '')
                setUniswapKeySource(src)
                setUniswapKeyEdit('')
              }}>清除</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
