import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Language = 'zh-CN' | 'en-US'
type CurrencyUnit = 'USD' | 'CNY'
type ThemeMode = 'system' | 'dark' | 'light'

type AppSettingsContextValue = {
  language: Language
  setLanguage: (next: Language) => void
  redUpGreenDown: boolean
  setRedUpGreenDown: (next: boolean) => void
  currencyUnit: CurrencyUnit
  setCurrencyUnit: (next: CurrencyUnit) => void
  themeMode: ThemeMode
  setThemeMode: (next: ThemeMode) => void
  resolvedTheme: 'dark' | 'light'
}

const STORAGE_KEYS = {
  language: 'app.settings.language',
  redUpGreenDown: 'app.settings.redUpGreenDown',
  currencyUnit: 'app.settings.currencyUnit',
  themeMode: 'app.settings.themeMode',
} as const

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function readStoredString<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw == null) return fallback
  return raw === '1'
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() =>
    readStoredString(STORAGE_KEYS.language, ['zh-CN', 'en-US'] as const, 'zh-CN'),
  )
  const [redUpGreenDown, setRedUpGreenDown] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEYS.redUpGreenDown, false),
  )
  const [currencyUnit, setCurrencyUnit] = useState<CurrencyUnit>(() =>
    readStoredString(STORAGE_KEYS.currencyUnit, ['USD', 'CNY'] as const, 'USD'),
  )
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStoredString(STORAGE_KEYS.themeMode, ['system', 'dark', 'light'] as const, 'system'),
  )
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const resolvedTheme: 'dark' | 'light' = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.language, language)
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.redUpGreenDown, redUpGreenDown ? '1' : '0')
    document.documentElement.classList.toggle('rise-green-up', redUpGreenDown)
  }, [redUpGreenDown])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.currencyUnit, currencyUnit)
  }, [currencyUnit])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEYS.themeMode, themeMode)
  }, [themeMode])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      language,
      setLanguage,
      redUpGreenDown,
      setRedUpGreenDown,
      currencyUnit,
      setCurrencyUnit,
      themeMode,
      setThemeMode,
      resolvedTheme,
    }),
    [language, redUpGreenDown, currencyUnit, themeMode, resolvedTheme],
  )

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider')
  return ctx
}

export function convertUsdToCurrency(usdValue: number, currency: CurrencyUnit): number {
  if (!Number.isFinite(usdValue)) return 0
  if (currency === 'CNY') return usdValue * 7.2
  return usdValue
}

export function formatCurrencyCompact(usdValue: number, currency: CurrencyUnit): string {
  const n = convertUsdToCurrency(usdValue, currency)
  if (currency === 'CNY') {
    if (Math.abs(n) >= 1e8) return `¥${(n / 1e8).toFixed(2)}亿`
    if (Math.abs(n) >= 1e4) return `¥${(n / 1e4).toFixed(2)}万`
    return `¥${n.toFixed(2)}`
  }
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

export function formatPriceByCurrency(usdValue: number, currency: CurrencyUnit): string {
  const n = convertUsdToCurrency(usdValue, currency)
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (n < 1) return `${symbol}${n.toFixed(6)}`
  if (n < 1000) return `${symbol}${n.toFixed(4)}`
  return `${symbol}${n.toFixed(2)}`
}
