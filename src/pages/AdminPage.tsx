import { useEffect, useMemo, useState } from 'react'
import {
  adminLogin,
  adminLogout,
  getAdminSystemConfig,
  getAdminTokenLibrary,
  getAdminPageConfig,
  setAdminSystemConfig,
  setAdminTokenLibrary,
  setAdminPageConfig,
  type ApiSystemConfig,
  type ManagedToken,
  type ManualHotToken,
  type PageConfig,
  type PageId,
  type SectionConfig,
} from '../api/admin'

const PAGES: Array<{ id: PageId; label: string; defaultSections: string[] }> = [
  { id: 'home', label: '首页', defaultSections: ['banner', 'tabs', 'market', 'quickNote'] },
  { id: 'market', label: '行情', defaultSections: ['controls', 'table', 'list'] },
  { id: 'newTokens', label: '新币', defaultSections: ['hero', 'chains', 'emptyNote'] },
  { id: 'bot', label: 'Bot', defaultSections: ['notice', 'chat'] },
  { id: 'swap', label: '交易', defaultSections: ['notice', 'swapForm', 'history'] },
  { id: 'wallet', label: '钱包', defaultSections: ['hero', 'assets', 'actions'] },
  { id: 'profile', label: '个人中心', defaultSections: ['hero', 'menu', 'api'] },
  { id: 'marketDetail', label: '详情页', defaultSections: ['topbar', 'price', 'chart', 'holders', 'detail'] },
]

function normalizeHomeTitle(pageId: PageId, title: string | undefined): string | undefined {
  const next = title?.trim()
  if (!next) return undefined
  if (pageId === 'home' && next.toLowerCase() === 'ave.ai') return 'clawdex.me'
  return next
}

function normalizeSections(input: unknown, defaults: string[]): SectionConfig[] {
  const arr = Array.isArray(input) ? input : []
  const map = new Map<string, SectionConfig>()
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const id = String((it as any).id ?? '').trim()
    if (!id) continue
    map.set(id, {
      id,
      enabled: Boolean((it as any).enabled ?? true),
      order: Number.isFinite(Number((it as any).order)) ? Number((it as any).order) : 0,
      props: (it as any).props && typeof (it as any).props === 'object' ? (it as any).props : undefined,
    })
  }
  // ensure defaults exist
  let order = 0
  for (const id of defaults) {
    if (!map.has(id)) {
      map.set(id, { id, enabled: true, order: order++, props: {} })
    }
  }
  const list = Array.from(map.values())
  list.sort((a, b) => a.order - b.order)
  // reindex
  return list.map((s, idx) => ({ ...s, order: idx }))
}

function emptyManualHotRow(): ManualHotToken {
  return {
    id: '',
    symbol: '',
    name: '',
    image: '',
    current_price: 0,
    price_change_percentage_24h: null,
    market_cap: 0,
    chain: 'bsc',
  }
}

/** 压缩为 JPEG Data URL，控制 Redis 配置体积 */
async function compressImageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('单张图片请勿超过 5MB')
  }
  try {
    const bitmap = await createImageBitmap(file)
    const maxDim = 256
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height, 1))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理图片')
    ctx.drawImage(bitmap, 0, 0, w, h)
    let q = 0.88
    let dataUrl = canvas.toDataURL('image/jpeg', q)
    const maxLen = 450_000
    while (dataUrl.length > maxLen && q > 0.45) {
      q -= 0.06
      dataUrl = canvas.toDataURL('image/jpeg', q)
    }
    if (dataUrl.length > 600_000) {
      throw new Error('压缩后仍过大，请换一张更小的图片')
    }
    return dataUrl
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(file)
    })
    if (dataUrl.length > 600_000) {
      throw new Error('当前环境无法压缩图片，文件过大，请换一张更小的图')
    }
    return dataUrl
  }
}

function move(list: SectionConfig[], idx: number, dir: -1 | 1) {
  const j = idx + dir
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  const tmp = next[idx]
  next[idx] = next[j]
  next[j] = tmp
  return next.map((s, i) => ({ ...s, order: i }))
}

function emptyManagedToken(): ManagedToken {
  return {
    id: '',
    symbol: '',
    name: '',
    image: '',
    chain: 'bsc',
    address: '',
    current_price: 0,
    price_change_percentage_24h: null,
    market_cap: 0,
    enabled: true,
    hot: false,
    rank: 0,
  }
}

function defaultSystemConfig(): ApiSystemConfig {
  return {
    market: {
      cacheTtlSeconds: 12,
      freshMs: 10_000,
      enableAlpha: true,
      retries: 1,
      sourceToggles: {
        dexScreener: true,
        birdeye: true,
        coinGecko: true,
        coinPaprika: true,
        coinCap: true,
      },
    },
    newTokens: { cacheTtlSeconds: 60 },
    ohlcv: { cacheTtlSeconds: 30 },
    apiKeys: { birdeyeApiKey: '' },
    ui: {
      bottomTabs: [
        { id: 'home', to: '/', label: '首页', icon: 'home', enabled: true },
        { id: 'market', to: '/market', label: '行情', icon: 'market', enabled: true },
        { id: 'bot', to: '/bot', label: 'Bot', icon: 'bot', enabled: true },
        { id: 'swap', to: '/swap', label: '交易', icon: 'swap', enabled: true },
        { id: 'wallet', to: '/wallet', label: '钱包', icon: 'wallet', enabled: true },
      ],
      homeTabs: [
        { id: 'hot', label: '热门', enabled: true },
        { id: 'alpha', label: '币安Alpha', enabled: true },
        { id: 'gain', label: '涨幅', enabled: true },
        { id: 'loss', label: '跌幅', enabled: true },
        { id: 'newTokens', label: '新币', enabled: true },
      ],
      homeFilters: [
        { id: 'all', label: 'All', enabled: true },
        { id: 'base', label: 'Base', enabled: true },
        { id: 'eth', label: 'ETH', enabled: true },
        { id: 'bsc', label: 'BSC', enabled: true },
      ],
      routeToggles: {
        market: true,
        newTokens: true,
        bot: true,
        swap: true,
        wallet: true,
        profile: true,
      },
    },
  }
}

export function AdminPage() {
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<PageId>('home')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [config, setConfig] = useState<PageConfig>({ title: '', subtitle: '', notice: '', sections: [] })
  const [manualHotRows, setManualHotRows] = useState<ManualHotToken[]>([])
  const [showManualJson, setShowManualJson] = useState(false)
  const [manualJsonDraft, setManualJsonDraft] = useState('[]')
  const [tokenLibraryRows, setTokenLibraryRows] = useState<ManagedToken[]>([])
  const [apiConfig, setApiConfig] = useState<ApiSystemConfig>(defaultSystemConfig())
  const [tokenLibrarySaving, setTokenLibrarySaving] = useState(false)
  const [apiConfigSaving, setApiConfigSaving] = useState(false)

  const defaults = useMemo(() => PAGES.find((p) => p.id === pageId)?.defaultSections ?? [], [pageId])

  const loadConfig = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await getAdminPageConfig(pageId)
      const c = res.config ?? {}
      const normalizedTitle = normalizeHomeTitle(pageId, c.title)
      setConfig({
        title: normalizedTitle ?? '',
        subtitle: c.subtitle ?? '',
        notice: c.notice ?? '',
        sections: normalizeSections(c.sections, defaults),
        updatedAt: c.updatedAt,
      })
      const mh = (c as PageConfig).manualHotTokens
      setManualHotRows(Array.isArray(mh) ? mh : [])
      setManualJsonDraft(JSON.stringify(Array.isArray(mh) ? mh : [], null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!loggedIn) return
    void loadConfig()
    void (async () => {
      try {
        const [tokenRes, apiRes] = await Promise.all([getAdminTokenLibrary(), getAdminSystemConfig()])
        setTokenLibraryRows(Array.isArray(tokenRes.items) ? tokenRes.items : [])
        setApiConfig(apiRes.config ? { ...defaultSystemConfig(), ...apiRes.config } : defaultSystemConfig())
      } catch (e) {
        setError(e instanceof Error ? e.message : '后台扩展配置加载失败')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, pageId])

  const onLogin = async () => {
    try {
      setLoginError(null)
      await adminLogin(password)
      setLoggedIn(true)
      setPassword('')
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : '登录失败')
    }
  }

  const onLogout = async () => {
    try {
      await adminLogout()
    } finally {
      setLoggedIn(false)
      setConfig({ title: '', subtitle: '', notice: '', sections: [] })
      setManualHotRows([])
      setManualJsonDraft('[]')
      setTokenLibraryRows([])
      setApiConfig(defaultSystemConfig())
    }
  }

  const onSaveTokenLibrary = async () => {
    try {
      setTokenLibrarySaving(true)
      setError(null)
      setSuccess(null)
      const rows = tokenLibraryRows
        .map((row) => ({
          ...row,
          id: String(row.id).trim(),
          symbol: String(row.symbol).trim(),
          name: String(row.name).trim() || String(row.symbol).trim(),
          image: String(row.image).trim(),
          chain: row.chain,
          address: String(row.address ?? '').trim(),
          current_price: Number(row.current_price) || 0,
          market_cap: Number(row.market_cap) || 0,
          rank: Number(row.rank ?? 0) || 0,
          enabled: row.enabled !== false,
          hot: Boolean(row.hot),
          price_change_percentage_24h:
            row.price_change_percentage_24h == null ? null : Number(row.price_change_percentage_24h),
        }))
        .filter((row) => row.id && row.symbol && row.image)
      const res = await setAdminTokenLibrary(rows)
      setTokenLibraryRows(res.items ?? [])
      setSuccess('代币库保存成功')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存代币库失败')
    } finally {
      setTokenLibrarySaving(false)
    }
  }

  const onSaveApiConfig = async () => {
    try {
      setApiConfigSaving(true)
      setError(null)
      setSuccess(null)
      const next: ApiSystemConfig = {
        market: {
          cacheTtlSeconds: Number(apiConfig.market?.cacheTtlSeconds ?? 12) || 12,
          freshMs: Number(apiConfig.market?.freshMs ?? 10_000) || 10_000,
          enableAlpha: apiConfig.market?.enableAlpha !== false,
          retries: Number(apiConfig.market?.retries ?? 1) || 1,
          sourceToggles: {
            dexScreener: apiConfig.market?.sourceToggles?.dexScreener !== false,
            birdeye: apiConfig.market?.sourceToggles?.birdeye !== false,
            coinGecko: apiConfig.market?.sourceToggles?.coinGecko !== false,
            coinPaprika: apiConfig.market?.sourceToggles?.coinPaprika !== false,
            coinCap: apiConfig.market?.sourceToggles?.coinCap !== false,
          },
        },
        newTokens: {
          cacheTtlSeconds: Number(apiConfig.newTokens?.cacheTtlSeconds ?? 60) || 60,
        },
        ohlcv: {
          cacheTtlSeconds: Number(apiConfig.ohlcv?.cacheTtlSeconds ?? 30) || 30,
        },
        apiKeys: {
          birdeyeApiKey: String(apiConfig.apiKeys?.birdeyeApiKey ?? '').trim(),
        },
        ui: {
          bottomTabs: (apiConfig.ui?.bottomTabs ?? []).map((t) => ({
            id: String(t.id ?? '').trim(),
            to: String(t.to ?? '').trim(),
            label: String(t.label ?? '').trim(),
            icon: String(t.icon ?? '').trim(),
            enabled: t.enabled !== false,
          })),
          homeTabs: (apiConfig.ui?.homeTabs ?? []).map((t) => ({
            id: t.id,
            label: String(t.label ?? '').trim(),
            enabled: t.enabled !== false,
          })),
          homeFilters: (apiConfig.ui?.homeFilters ?? []).map((f) => ({
            id: f.id,
            label: String(f.label ?? '').trim(),
            enabled: f.enabled !== false,
          })),
          routeToggles: {
            market: apiConfig.ui?.routeToggles?.market !== false,
            newTokens: apiConfig.ui?.routeToggles?.newTokens !== false,
            bot: apiConfig.ui?.routeToggles?.bot !== false,
            swap: apiConfig.ui?.routeToggles?.swap !== false,
            wallet: apiConfig.ui?.routeToggles?.wallet !== false,
            profile: apiConfig.ui?.routeToggles?.profile !== false,
          },
        },
      }
      const res = await setAdminSystemConfig(next)
      setApiConfig(res.config ?? next)
      setSuccess('API 配置保存成功')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存 API 配置失败')
    } finally {
      setApiConfigSaving(false)
    }
  }

  const onSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const sections = normalizeSections(config.sections, defaults)
      let manualHotTokens: ManualHotToken[] | undefined
      if (pageId === 'home') {
        if (showManualJson) {
          try {
            const parsed = JSON.parse(manualJsonDraft || '[]') as unknown
            if (!Array.isArray(parsed)) throw new Error('手动热门须为 JSON 数组')
            manualHotTokens = parsed as ManualHotToken[]
          } catch (e) {
            if (e instanceof SyntaxError) throw new Error('手动热门 JSON 格式错误')
            throw e
          }
        } else {
          manualHotTokens = manualHotRows
            .map((r) => ({
              ...r,
              id: String(r.id).trim(),
              symbol: String(r.symbol).trim(),
              name: String(r.name).trim() || String(r.symbol).trim(),
              image: String(r.image).trim(),
              current_price: Number(r.current_price) || 0,
              market_cap: Number(r.market_cap) || 0,
              price_change_percentage_24h:
                r.price_change_percentage_24h == null ? null : Number(r.price_change_percentage_24h),
              chain: r.chain,
            }))
            .filter((r) => r.id && r.symbol && r.image)
        }
      } else {
        manualHotTokens = config.manualHotTokens ?? []
      }
      const next: PageConfig = {
        title: normalizeHomeTitle(pageId, config.title),
        subtitle: config.subtitle?.trim() || undefined,
        notice: config.notice?.trim() || undefined,
        sections,
        manualHotTokens,
      }
      const res = await setAdminPageConfig(pageId, next)
      const c = res.config
      const normalizedTitle = normalizeHomeTitle(pageId, c.title)
      setConfig({
        title: normalizedTitle ?? '',
        subtitle: c.subtitle ?? '',
        notice: c.notice ?? '',
        sections: normalizeSections(c.sections, defaults),
        manualHotTokens: c.manualHotTokens ?? [],
        updatedAt: c.updatedAt,
      })
      const mh = c.manualHotTokens ?? []
      setManualHotRows(Array.isArray(mh) ? mh : [])
      setManualJsonDraft(JSON.stringify(Array.isArray(mh) ? mh : [], null, 2))
      setSuccess('页面配置保存成功')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="page ave-page admin-page">
        <div className="card">
          <h2 style={{ margin: 0 }}>后台管理</h2>
          <p className="tip" style={{ marginTop: 8 }}>请输入管理员密码登录。</p>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <input
              type="password"
              value={password}
              placeholder="管理员密码"
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: 12, borderRadius: 12 }}
            />
            <button type="button" className="btn-primary" onClick={() => void onLogin()}>
              登录
            </button>
            {loginError && <p className="error">{loginError}</p>}
          </div>
        </div>
      </div>
    )
  }

  const sections = normalizeSections(config.sections, defaults)

  return (
    <div className="page ave-page admin-page">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>后台管理</h2>
            <div className="tip" style={{ marginTop: 6 }}>
              {config.updatedAt ? `上次保存：${new Date(config.updatedAt).toLocaleString('zh-CN')}` : '尚未保存过配置'}
            </div>
          </div>
          {(error || success) && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${error ? 'rgba(239,68,68,.5)' : 'rgba(34,197,94,.5)'}`, color: error ? '#fca5a5' : '#86efac', background: error ? 'rgba(127,29,29,.18)' : 'rgba(20,83,45,.18)' }}>
              {error ?? success}
            </div>
          )}
          <button type="button" className="btn-ghost" onClick={() => void onLogout()}>
            退出登录
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="tip">选择页面</span>
            <select
              value={pageId}
              onChange={(e) => setPageId(e.target.value as PageId)}
              style={{ padding: 12, borderRadius: 12 }}
            >
              {PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>

          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="tip">页面标题（可选）</span>
              <input
                value={config.title ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
                placeholder="例如：ClawDEX"
                style={{ padding: 12, borderRadius: 12 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="tip">页面副标题（可选）</span>
              <input
                value={config.subtitle ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, subtitle: e.target.value }))}
                placeholder="例如：合约直播 · 看见交易的另一种可能"
                style={{ padding: 12, borderRadius: 12 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="tip">顶部公告（可选）</span>
              <input
                value={config.notice ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, notice: e.target.value }))}
                placeholder="例如：系统维护中/上新公告"
                style={{ padding: 12, borderRadius: 12 }}
              />
            </label>
            {pageId === 'home' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span className="tip">热门代币手动白名单（可上传头像，或填图片链接）</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setManualHotRows((rows) => [...rows, emptyManualHotRow()])}
                    >
                      添加一行
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        if (showManualJson) {
                          try {
                            const parsed = JSON.parse(manualJsonDraft || '[]') as unknown
                            if (!Array.isArray(parsed)) throw new Error('须为 JSON 数组')
                            setManualHotRows(parsed as ManualHotToken[])
                            setShowManualJson(false)
                            setError(null)
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'JSON 无效')
                          }
                        } else {
                          setManualJsonDraft(JSON.stringify(manualHotRows, null, 2))
                          setShowManualJson(true)
                        }
                      }}
                    >
                      {showManualJson ? '关闭 JSON 并应用' : '高级：编辑 JSON'}
                    </button>
                  </div>
                </div>

                {!showManualJson && (
                  <div style={{ display: 'grid', gap: 14 }}>
                    {manualHotRows.length === 0 && (
                      <p className="tip" style={{ margin: 0 }}>暂无条目，点击「添加一行」，填写 id（如 bsc:0x…）、上传头像后保存。</p>
                    )}
                    {manualHotRows.map((row, idx) => (
                      <div
                        key={`hot-${idx}`}
                        style={{
                          border: '1px solid var(--border, rgba(255,255,255,.12))',
                          borderRadius: 12,
                          padding: 12,
                          display: 'grid',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>代币 #{idx + 1}</span>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => setManualHotRows((rows) => rows.filter((_, i) => i !== idx))}
                          >
                            删除此行
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">id（链:合约）</span>
                            <input
                              value={row.id}
                              onChange={(e) => {
                                const v = e.target.value
                                setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, id: v } : r)))
                              }}
                              placeholder="bsc:0x..."
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">chain</span>
                            <select
                              value={row.chain}
                              onChange={(e) => {
                                const chain = e.target.value as ManualHotToken['chain']
                                setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, chain } : r)))
                              }}
                              style={{ padding: 10, borderRadius: 10 }}
                            >
                              <option value="eth">eth</option>
                              <option value="bsc">bsc</option>
                              <option value="base">base</option>
                              <option value="polygon">polygon</option>
                            </select>
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">symbol</span>
                            <input
                              value={row.symbol}
                              onChange={(e) => setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, symbol: e.target.value } : r)))}
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">name</span>
                            <input
                              value={row.name}
                              onChange={(e) => setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">current_price</span>
                            <input
                              type="number"
                              step="any"
                              value={row.current_price}
                              onChange={(e) =>
                                setManualHotRows((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, current_price: Number(e.target.value) } : r)),
                                )
                              }
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">24h 涨跌 %</span>
                            <input
                              type="number"
                              step="any"
                              value={row.price_change_percentage_24h ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                setManualHotRows((rows) =>
                                  rows.map((r, i) =>
                                    i === idx
                                      ? { ...r, price_change_percentage_24h: v === '' ? null : Number(v) }
                                      : r,
                                  ),
                                )
                              }}
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 4 }}>
                            <span className="tip">market_cap</span>
                            <input
                              type="number"
                              step="any"
                              value={row.market_cap}
                              onChange={(e) =>
                                setManualHotRows((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, market_cap: Number(e.target.value) } : r)),
                                )
                              }
                              style={{ padding: 10, borderRadius: 10 }}
                            />
                          </label>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                          <label style={{ display: 'grid', gap: 6 }}>
                            <span className="tip">头像（上传或下方填 URL）</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                e.target.value = ''
                                if (!f) return
                                void (async () => {
                                  try {
                                    const dataUrl = await compressImageToDataUrl(f)
                                    setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, image: dataUrl } : r)))
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : '图片处理失败')
                                  }
                                })()
                              }}
                            />
                          </label>
                          {row.image ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <img
                                src={row.image}
                                alt=""
                                style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border, rgba(255,255,255,.12))' }}
                              />
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, image: '' } : r)))}
                              >
                                清除头像
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="tip">image（https 链接；上传后会自动填入 Base64）</span>
                          <input
                            value={row.image.startsWith('data:') ? '' : row.image}
                            readOnly={row.image.startsWith('data:')}
                            placeholder="https://... 或上传图片"
                            onChange={(e) => setManualHotRows((rows) => rows.map((r, i) => (i === idx ? { ...r, image: e.target.value.trim() } : r)))}
                            style={{ padding: 10, borderRadius: 10 }}
                          />
                          {row.image.startsWith('data:') && (
                            <span className="tip">已使用上传图片（Base64），无需填链接。</span>
                          )}
                        </label>
                      </div>
                    ))}
                  </div>
                )}

                {showManualJson && (
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="tip">手动编辑 JSON（与表单二选一保存；开启时以本框为准）</span>
                    <textarea
                      value={manualJsonDraft}
                      onChange={(e) => setManualJsonDraft(e.target.value)}
                      style={{ minHeight: 220, padding: 12, borderRadius: 12, fontFamily: 'monospace' }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>模块开关与排序</div>
                <div className="tip" style={{ marginTop: 4 }}>开关/顺序会影响前台渲染（未接入的模块会忽略）。</div>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfig((c) => ({
                  ...c,
                  sections: [...normalizeSections(c.sections, defaults), { id: `section_${Date.now()}`, enabled: true, order: sections.length, props: {} }],
                }))}
              >
                新增模块
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {sections.map((s, idx) => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center' }}>
                  <input
                    value={s.id}
                    onChange={(e) => {
                      const v = e.target.value
                      setConfig((c) => ({
                        ...c,
                        sections: normalizeSections(c.sections, defaults).map((x) => (x.id === s.id ? { ...x, id: v } : x)),
                      }))
                    }}
                    style={{ padding: 10, borderRadius: 10 }}
                  />
                  <button
                    type="button"
                    className={`btn-ghost ${s.enabled ? '' : 'active'}`}
                    onClick={() => setConfig((c) => ({
                      ...c,
                      sections: normalizeSections(c.sections, defaults).map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
                    }))}
                  >
                    {s.enabled ? '启用' : '禁用'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfig((c) => ({ ...c, sections: move(normalizeSections(c.sections, defaults), idx, -1) }))}>
                    上移
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setConfig((c) => ({ ...c, sections: move(normalizeSections(c.sections, defaults), idx, 1) }))}>
                    下移
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>代币库管理（含热门代币）</div>
                <div className="tip" style={{ marginTop: 4 }}>支持全局代币条目；勾选“热门”后会并入首页热门池。</div>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setTokenLibraryRows((rows) => [...rows, emptyManagedToken()])}
              >
                添加代币
              </button>
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {tokenLibraryRows.length === 0 && <div className="tip">暂无代币条目。</div>}
              {tokenLibraryRows.map((row, idx) => (
                <div key={`lib-${idx}`} style={{ border: '1px solid var(--border, rgba(255,255,255,.12))', borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                    <input value={row.id} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, id: e.target.value } : it))} placeholder="id: chain:0x..." style={{ padding: 10, borderRadius: 10 }} />
                    <input value={row.symbol} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, symbol: e.target.value } : it))} placeholder="symbol" style={{ padding: 10, borderRadius: 10 }} />
                    <input value={row.name} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, name: e.target.value } : it))} placeholder="name" style={{ padding: 10, borderRadius: 10 }} />
                    <input value={row.image} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, image: e.target.value } : it))} placeholder="image URL" style={{ padding: 10, borderRadius: 10 }} />
                    <select value={row.chain} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, chain: e.target.value as ManagedToken['chain'] } : it))} style={{ padding: 10, borderRadius: 10 }}>
                      <option value="eth">eth</option>
                      <option value="bsc">bsc</option>
                      <option value="base">base</option>
                      <option value="polygon">polygon</option>
                    </select>
                    <input type="number" value={row.current_price} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, current_price: Number(e.target.value) } : it))} placeholder="price" style={{ padding: 10, borderRadius: 10 }} />
                    <input type="number" value={row.market_cap} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, market_cap: Number(e.target.value) } : it))} placeholder="market cap" style={{ padding: 10, borderRadius: 10 }} />
                    <input type="number" value={row.rank ?? 0} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, rank: Number(e.target.value) } : it))} placeholder="rank" style={{ padding: 10, borderRadius: 10 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={row.enabled !== false} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, enabled: e.target.checked } : it))} />
                      <span className="tip">启用</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={Boolean(row.hot)} onChange={(e) => setTokenLibraryRows((r) => r.map((it, i) => i === idx ? { ...it, hot: e.target.checked } : it))} />
                      <span className="tip">热门</span>
                    </label>
                    <button type="button" className="btn-ghost" onClick={() => setTokenLibraryRows((r) => r.filter((_, i) => i !== idx))}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary" disabled={tokenLibrarySaving} onClick={() => void onSaveTokenLibrary()}>
                {tokenLibrarySaving ? '保存中…' : '保存代币库'}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700 }}>API 管理</div>
            <div className="tip" style={{ marginTop: 4 }}>配置缓存、数据源开关、回退重试与 Birdeye Key。</div>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                <input type="number" value={apiConfig.market?.cacheTtlSeconds ?? 12} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, cacheTtlSeconds: Number(e.target.value) } }))} placeholder="market ttl(sec)" style={{ padding: 10, borderRadius: 10 }} />
                <input type="number" value={apiConfig.market?.freshMs ?? 10000} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, freshMs: Number(e.target.value) } }))} placeholder="market fresh(ms)" style={{ padding: 10, borderRadius: 10 }} />
                <input type="number" value={apiConfig.market?.retries ?? 1} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, retries: Number(e.target.value) } }))} placeholder="market retries" style={{ padding: 10, borderRadius: 10 }} />
                <input type="number" value={apiConfig.newTokens?.cacheTtlSeconds ?? 60} onChange={(e) => setApiConfig((c) => ({ ...c, newTokens: { ...c.newTokens, cacheTtlSeconds: Number(e.target.value) } }))} placeholder="new-tokens ttl(sec)" style={{ padding: 10, borderRadius: 10 }} />
                <input type="number" value={apiConfig.ohlcv?.cacheTtlSeconds ?? 30} onChange={(e) => setApiConfig((c) => ({ ...c, ohlcv: { ...c.ohlcv, cacheTtlSeconds: Number(e.target.value) } }))} placeholder="ohlcv ttl(sec)" style={{ padding: 10, borderRadius: 10 }} />
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="tip">Birdeye API Key（服务端）</span>
                <input value={apiConfig.apiKeys?.birdeyeApiKey ?? ''} onChange={(e) => setApiConfig((c) => ({ ...c, apiKeys: { ...c.apiKeys, birdeyeApiKey: e.target.value } }))} style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.enableAlpha !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, enableAlpha: e.target.checked } }))} />
                  <span className="tip">启用币安Alpha</span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.sourceToggles?.dexScreener !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, sourceToggles: { ...c.market?.sourceToggles, dexScreener: e.target.checked } } }))} />
                  <span className="tip">DexScreener</span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.sourceToggles?.birdeye !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, sourceToggles: { ...c.market?.sourceToggles, birdeye: e.target.checked } } }))} />
                  <span className="tip">Birdeye</span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.sourceToggles?.coinGecko !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, sourceToggles: { ...c.market?.sourceToggles, coinGecko: e.target.checked } } }))} />
                  <span className="tip">CoinGecko</span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.sourceToggles?.coinPaprika !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, sourceToggles: { ...c.market?.sourceToggles, coinPaprika: e.target.checked } } }))} />
                  <span className="tip">CoinPaprika</span>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={apiConfig.market?.sourceToggles?.coinCap !== false} onChange={(e) => setApiConfig((c) => ({ ...c, market: { ...c.market, sourceToggles: { ...c.market?.sourceToggles, coinCap: e.target.checked } } }))} />
                  <span className="tip">CoinCap</span>
                </label>
              </div>
              <div style={{ borderTop: '1px solid rgba(148,163,184,.2)', paddingTop: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>全站标签与功能控制</div>
                <div className="tip" style={{ marginBottom: 8 }}>所有页面标签、底部导航、路由入口都可在这里开关和改名。</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div>
                    <div className="tip" style={{ marginBottom: 6 }}>底部导航标签</div>
                    {(apiConfig.ui?.bottomTabs ?? []).map((tab, idx) => (
                      <div key={`btab-${tab.id}-${idx}`} style={{ display: 'grid', gap: 8, gridTemplateColumns: '120px 120px 1fr auto', marginBottom: 6 }}>
                        <input value={tab.id} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, bottomTabs: (c.ui?.bottomTabs ?? []).map((it, i) => i === idx ? { ...it, id: e.target.value } : it) } }))} style={{ padding: 8, borderRadius: 8 }} />
                        <input value={tab.to} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, bottomTabs: (c.ui?.bottomTabs ?? []).map((it, i) => i === idx ? { ...it, to: e.target.value } : it) } }))} style={{ padding: 8, borderRadius: 8 }} />
                        <input value={tab.label} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, bottomTabs: (c.ui?.bottomTabs ?? []).map((it, i) => i === idx ? { ...it, label: e.target.value } : it) } }))} style={{ padding: 8, borderRadius: 8 }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={tab.enabled !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, bottomTabs: (c.ui?.bottomTabs ?? []).map((it, i) => i === idx ? { ...it, enabled: e.target.checked } : it) } }))} />
                          <span className="tip">启用</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="tip" style={{ marginBottom: 6 }}>首页标签（热门/Alpha/涨跌幅/新币）</div>
                    {(apiConfig.ui?.homeTabs ?? []).map((tab, idx) => (
                      <div key={`htab-${tab.id}-${idx}`} style={{ display: 'grid', gap: 8, gridTemplateColumns: '120px 1fr auto', marginBottom: 6 }}>
                        <input value={tab.id} readOnly style={{ padding: 8, borderRadius: 8, opacity: .7 }} />
                        <input value={tab.label} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, homeTabs: (c.ui?.homeTabs ?? []).map((it, i) => i === idx ? { ...it, label: e.target.value } : it) } }))} style={{ padding: 8, borderRadius: 8 }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={tab.enabled !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, homeTabs: (c.ui?.homeTabs ?? []).map((it, i) => i === idx ? { ...it, enabled: e.target.checked } : it) } }))} />
                          <span className="tip">启用</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="tip" style={{ marginBottom: 6 }}>首页链筛选标签</div>
                    {(apiConfig.ui?.homeFilters ?? []).map((f, idx) => (
                      <div key={`hfilter-${f.id}-${idx}`} style={{ display: 'grid', gap: 8, gridTemplateColumns: '120px 1fr auto', marginBottom: 6 }}>
                        <input value={f.id} readOnly style={{ padding: 8, borderRadius: 8, opacity: .7 }} />
                        <input value={f.label} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, homeFilters: (c.ui?.homeFilters ?? []).map((it, i) => i === idx ? { ...it, label: e.target.value } : it) } }))} style={{ padding: 8, borderRadius: 8 }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={f.enabled !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, homeFilters: (c.ui?.homeFilters ?? []).map((it, i) => i === idx ? { ...it, enabled: e.target.checked } : it) } }))} />
                          <span className="tip">启用</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.market !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, market: e.target.checked } } }))} />
                      <span className="tip">行情页</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.newTokens !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, newTokens: e.target.checked } } }))} />
                      <span className="tip">新币页</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.bot !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, bot: e.target.checked } } }))} />
                      <span className="tip">Bot页</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.swap !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, swap: e.target.checked } } }))} />
                      <span className="tip">交易页</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.wallet !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, wallet: e.target.checked } } }))} />
                      <span className="tip">钱包页</span>
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={apiConfig.ui?.routeToggles?.profile !== false} onChange={(e) => setApiConfig((c) => ({ ...c, ui: { ...c.ui, routeToggles: { ...c.ui?.routeToggles, profile: e.target.checked } } }))} />
                      <span className="tip">个人中心</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary" disabled={apiConfigSaving} onClick={() => void onSaveApiConfig()}>
                {apiConfigSaving ? '保存中…' : '保存 API 配置'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-ghost" disabled={loading || saving} onClick={() => void loadConfig()}>
              {loading ? '加载中…' : '重新加载'}
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void onSave()}>
              {saving ? '保存中…' : '保存页面配置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
