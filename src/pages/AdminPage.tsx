import { useEffect, useMemo, useState } from 'react'
import {
  adminLogin,
  adminLogout,
  getAdminPageConfig,
  setAdminPageConfig,
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
]

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

export function AdminPage() {
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<PageId>('home')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<PageConfig>({ title: '', subtitle: '', notice: '', sections: [] })
  const [manualHotRows, setManualHotRows] = useState<ManualHotToken[]>([])
  const [showManualJson, setShowManualJson] = useState(false)
  const [manualJsonDraft, setManualJsonDraft] = useState('[]')

  const defaults = useMemo(() => PAGES.find((p) => p.id === pageId)?.defaultSections ?? [], [pageId])

  const loadConfig = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await getAdminPageConfig(pageId)
      const c = res.config ?? {}
      setConfig({
        title: c.title ?? '',
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
    }
  }

  const onSave = async () => {
    try {
      setSaving(true)
      setError(null)
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
              name: String(r.name).trim(),
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
        title: config.title?.trim() || undefined,
        subtitle: config.subtitle?.trim() || undefined,
        notice: config.notice?.trim() || undefined,
        sections,
        manualHotTokens,
      }
      const res = await setAdminPageConfig(pageId, next)
      const c = res.config
      setConfig({
        title: c.title ?? '',
        subtitle: c.subtitle ?? '',
        notice: c.notice ?? '',
        sections: normalizeSections(c.sections, defaults),
        manualHotTokens: c.manualHotTokens ?? [],
        updatedAt: c.updatedAt,
      })
      const mh = c.manualHotTokens ?? []
      setManualHotRows(Array.isArray(mh) ? mh : [])
      setManualJsonDraft(JSON.stringify(Array.isArray(mh) ? mh : [], null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!loggedIn) {
    return (
      <div className="page ave-page">
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
    <div className="page ave-page">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>后台管理</h2>
            <div className="tip" style={{ marginTop: 6 }}>
              {config.updatedAt ? `上次保存：${new Date(config.updatedAt).toLocaleString('zh-CN')}` : '尚未保存过配置'}
            </div>
          </div>
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

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-ghost" disabled={loading || saving} onClick={() => void loadConfig()}>
              {loading ? '加载中…' : '重新加载'}
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void onSave()}>
              {saving ? '保存中…' : '保存配置'}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  )
}

