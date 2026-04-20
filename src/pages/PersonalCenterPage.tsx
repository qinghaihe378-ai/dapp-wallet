import { useState } from 'react'

export function PersonalCenterPage() {
  const [redGreenUp, setRedGreenUp] = useState(false)
  const [fingerPay, setFingerPay] = useState(false)

  const renderArrow = () => <span className="ave-profile-arrow">›</span>
  const renderValue = (value: string) => <span className="ave-profile-value">{value}</span>

  return (
    <div className="page ave-page ave-profile-ave-shell">
      <div className="ave-profile-group">
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">语言切换</span>
          <span className="ave-profile-right">
            {renderValue('简体中文')}
            {renderArrow()}
          </span>
        </button>

        <div className="ave-profile-row">
          <span className="ave-profile-label">红涨绿跌</span>
          <button
            type="button"
            className={`ave-profile-toggle ${redGreenUp ? 'active' : ''}`}
            aria-pressed={redGreenUp}
            onClick={() => setRedGreenUp((v) => !v)}
          >
            <span />
          </button>
        </div>

        <div className="ave-profile-row">
          <span className="ave-profile-label">指纹支付</span>
          <button
            type="button"
            className={`ave-profile-toggle ${fingerPay ? 'active' : ''}`}
            aria-pressed={fingerPay}
            onClick={() => setFingerPay((v) => !v)}
          >
            <span />
          </button>
        </div>

        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">悬浮窗口</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">链节点管理</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">通知管理</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">符文 & 铭文</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">货币单位</span>
          <span className="ave-profile-right">
            {renderValue('USD')}
            {renderArrow()}
          </span>
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">主题模式</span>
          <span className="ave-profile-right">
            {renderValue('跟随系统')}
            {renderArrow()}
          </span>
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">黑名单管理</span>
          {renderArrow()}
        </button>
      </div>

      <div className="ave-profile-group ave-profile-group-secondary">
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">全球社区</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">关于我们</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">联系客服</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">生态伙伴</span>
          {renderArrow()}
        </button>
      </div>
    </div>
  )
}
