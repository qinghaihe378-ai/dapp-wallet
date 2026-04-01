import { useEffect, useMemo, useState } from 'react'
import { adminLogin, adminLogout, getAdminPageConfig, setAdminPageConfig, type PageConfig, type PageId, type SectionConfig } from '../api/admin'

const PAGES: Array<{ id: PageId; label: string; defaultSections: string[] }> = [
  { id: 'home', label: '首页', defaultSections: ['banner', 'tabs', 'market', 'quickNote'] },
  { id: 'market', label: '行情', defaultSections: ['controls', 'table', 'list'] },
  { id: 'newTokens', label: '新币', defaultSections: ['hero', 'chains', 'emptyNote'] },
  { id: 'bot', label: 'Bot', defaultSections: ['notice', 'chat'] },
  { id: 'boot', label: 'Boot', defaultSections: ['notice', 'chat', 'tasks', 'risk', 'copy'] },
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
    }
  }

  const onSave = async () => {
    try {
      setSaving(true)
      setError(null)
      const sections = normalizeSections(config.sections, defaults)
      const next: PageConfig = {
        title: config.title?.trim() || undefined,
        subtitle: config.subtitle?.trim() || undefined,
        notice: config.notice?.trim() || undefined,
        sections,
      }
      const res = await setAdminPageConfig(pageId, next)
      const c = res.config
      setConfig({
        title: c.title ?? '',
        subtitle: c.subtitle ?? '',
        notice: c.notice ?? '',
        sections: normalizeSections(c.sections, defaults),
        updatedAt: c.updatedAt,
      })
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

