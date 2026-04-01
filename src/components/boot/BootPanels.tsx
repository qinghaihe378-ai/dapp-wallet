import type { BootTask } from '../../lib/boot/taskEngine'
import type { BootRiskConfig } from '../../lib/boot/riskRules'
import { bootHelpText } from '../../lib/boot/commandParser'

type CopyState = { addresses: string[]; enabled: boolean }

type Props = {
  tasks: BootTask[]
  risk: BootRiskConfig
  copy: CopyState
  onCancel: (id: string) => void
  onRiskChange: (r: BootRiskConfig) => void
  onCopyRemove: (addr: string) => void
  onCopyToggle: () => void
  onApplyTemplate: (text: string) => void
}

export function BootTaskPanel({ tasks, onCancel }: Pick<Props, 'tasks' | 'onCancel'>) {
  const active = tasks.filter((t) => t.status === 'pending' || t.status === 'running')
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled').slice(0, 8)
  return (
    <div className="boot-panel card">
      <div className="boot-panel-title">任务中心</div>
      <div className="boot-panel-sub">运行中 {active.length} 条</div>
      <ul className="boot-task-list">
        {active.map((t) => (
          <li key={t.id}>
            <span className="boot-task-id">{t.id}</span>
            <span>{t.title}</span>
            <button type="button" className="btn-ghost boot-task-cancel" onClick={() => onCancel(t.id)}>
              取消
            </button>
          </li>
        ))}
        {active.length === 0 && <li className="tip">暂无运行中任务</li>}
      </ul>
      {done.length > 0 && (
        <>
          <div className="boot-panel-sub">最近</div>
          <ul className="boot-task-list boot-task-done">
            {done.map((t) => (
              <li key={t.id}>
                {t.title} · {t.status}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export function BootRiskPanel({ risk, onRiskChange }: Pick<Props, 'risk' | 'onRiskChange'>) {
  return (
    <div className="boot-panel card">
      <div className="boot-panel-title">风控</div>
      <label className="boot-field">
        最大滑点 %
        <input
          type="number"
          value={risk.maxSlippagePercent}
          min={0.1}
          max={50}
          step={0.1}
          onChange={(e) => onRiskChange({ ...risk, maxSlippagePercent: parseFloat(e.target.value) || 0 })}
        />
      </label>
      <label className="boot-field">
        单笔上限 USD
        <input
          type="number"
          value={risk.maxSingleTradeUsd}
          min={0}
          onChange={(e) => onRiskChange({ ...risk, maxSingleTradeUsd: parseFloat(e.target.value) || 0 })}
        />
      </label>
      <label className="boot-field">
        日预算 USD
        <input
          type="number"
          value={risk.dailyBudgetUsd}
          min={0}
          onChange={(e) => onRiskChange({ ...risk, dailyBudgetUsd: parseFloat(e.target.value) || 0 })}
        />
      </label>
      <label className="boot-field">
        最低流动性 USD
        <input
          type="number"
          value={risk.minLiquidityUsd}
          min={0}
          onChange={(e) => onRiskChange({ ...risk, minLiquidityUsd: parseFloat(e.target.value) || 0 })}
        />
      </label>
      <label className="boot-field">
        黑名单（逗号分隔地址）
        <input
          type="text"
          value={risk.blacklist.join(',')}
          onChange={(e) =>
            onRiskChange({
              ...risk,
              blacklist: e.target.value
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="boot-field">
        白名单（空=不限制；逗号分隔）
        <input
          type="text"
          value={risk.whitelist.join(',')}
          onChange={(e) =>
            onRiskChange({
              ...risk,
              whitelist: e.target.value
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
        />
      </label>
    </div>
  )
}

export function BootCopyPanel({ copy, onCopyRemove, onCopyToggle }: Pick<Props, 'copy' | 'onCopyRemove' | 'onCopyToggle'>) {
  return (
    <div className="boot-panel card">
      <div className="boot-panel-title">跟单地址</div>
      <div className="boot-panel-sub">
        状态：<strong>{copy.enabled ? '开' : '关'}</strong>
        <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={onCopyToggle}>
          切换
        </button>
      </div>
      <p className="tip" style={{ fontSize: 12 }}>
        Beta：开启后定时检测地址链上活动；全自动镜像交易依赖 RPC，建议小额测试。
      </p>
      <ul className="boot-task-list">
        {copy.addresses.map((a) => (
          <li key={a}>
            <span className="boot-mono">{a.slice(0, 8)}…{a.slice(-6)}</span>
            <button type="button" className="btn-ghost" onClick={() => onCopyRemove(a)}>
              移除
            </button>
          </li>
        ))}
        {copy.addresses.length === 0 && <li className="tip">跟单添加 &lt;地址&gt;</li>}
      </ul>
    </div>
  )
}

export function BootTemplateBar({ onApplyTemplate }: Pick<Props, 'onApplyTemplate'>) {
  const items = [
    { label: '买 BNB→USDT', text: '买 0.1 BNB 的 USDT' },
    { label: 'Base ETH→USDC', text: 'base 买 0.01 ETH 的 USDC' },
    { label: '卖 USDT→BNB', text: '卖 10 USDT 换 BNB' },
    { label: '帮助', text: '帮助' },
  ]
  return (
    <div className="boot-templates">
      {items.map((x) => (
        <button key={x.label} type="button" className="boot-template-chip" onClick={() => onApplyTemplate(x.text)}>
          {x.label}
        </button>
      ))}
      <button type="button" className="boot-template-chip" onClick={() => onApplyTemplate(bootHelpText())}>
        说明全文
      </button>
    </div>
  )
}
