import { useAppSettings } from '../components/AppSettingsProvider'

export function PersonalCenterPage() {
  const {
    language,
    setLanguage,
    redUpGreenDown,
    setRedUpGreenDown,
    currencyUnit,
    setCurrencyUnit,
    themeMode,
    setThemeMode,
  } = useAppSettings()

  const isEn = language === 'en-US'
  const t = (zh: string, en: string) => (isEn ? en : zh)
  const themeLabel = themeMode === 'system' ? t('跟随系统', 'System') : themeMode === 'dark' ? t('深色', 'Dark') : t('浅色', 'Light')

  const renderArrow = () => <span className="ave-profile-arrow">›</span>
  const renderValue = (value: string) => <span className="ave-profile-value">{value}</span>

  return (
    <div className="page ave-page ave-profile-ave-shell">
      <div className="ave-profile-group">
        <button type="button" className="ave-profile-row" onClick={() => setLanguage(isEn ? 'zh-CN' : 'en-US')}>
          <span className="ave-profile-label">{t('语言切换', 'Language')}</span>
          <span className="ave-profile-right">
            {renderValue(isEn ? 'English' : '简体中文')}
            {renderArrow()}
          </span>
        </button>

        <div className="ave-profile-row">
          <span className="ave-profile-label">{t('红涨绿跌', 'Red Up / Green Down')}</span>
          <button
            type="button"
            className={`ave-profile-toggle ${redUpGreenDown ? 'active' : ''}`}
            aria-pressed={redUpGreenDown}
            onClick={() => setRedUpGreenDown(!redUpGreenDown)}
          >
            <span />
          </button>
        </div>

        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('悬浮窗口', 'Floating Window')}</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('通知管理', 'Notifications')}</span>
          {renderArrow()}
        </button>
        <button
          type="button"
          className="ave-profile-row"
          onClick={() => setCurrencyUnit(currencyUnit === 'USD' ? 'CNY' : 'USD')}
        >
          <span className="ave-profile-label">{t('货币单位', 'Currency')}</span>
          <span className="ave-profile-right">
            {renderValue(currencyUnit)}
            {renderArrow()}
          </span>
        </button>
        <button
          type="button"
          className="ave-profile-row"
          onClick={() => setThemeMode(themeMode === 'system' ? 'dark' : themeMode === 'dark' ? 'light' : 'system')}
        >
          <span className="ave-profile-label">{t('主题模式', 'Theme')}</span>
          <span className="ave-profile-right">
            {renderValue(themeLabel)}
            {renderArrow()}
          </span>
        </button>
      </div>

      <div className="ave-profile-group ave-profile-group-secondary">
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('全球社区', 'Global Community')}</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('关于我们', 'About Us')}</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('联系客服', 'Support')}</span>
          {renderArrow()}
        </button>
        <button type="button" className="ave-profile-row">
          <span className="ave-profile-label">{t('生态伙伴', 'Partners')}</span>
          {renderArrow()}
        </button>
      </div>
    </div>
  )
}
