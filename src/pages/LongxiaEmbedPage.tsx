import { useMemo } from 'react'
import { getLongxiaIframeSrc } from '../lib/longxiaIframeSrc'

export function LongxiaEmbedPage() {
  const src = useMemo(() => getLongxiaIframeSrc(), [])

  return (
    <div className="longxia-embed-page">
      {import.meta.env.DEV &&
      !import.meta.env.VITE_LOBSTER_LAUNCH_URL?.trim() &&
      !import.meta.env.VITE_LONGXIA_DEV_ORIGIN?.trim() ? (
        <p className="longxia-embed-hint">
          开发模式：请另开终端执行 <code>cd longxia/web && npm run dev</code>，或配置{' '}
          <code>VITE_LONGXIA_DEV_ORIGIN</code>。
        </p>
      ) : null}
      <iframe
        title="龙虾 BSC 发币"
        className="longxia-embed-frame"
        src={src}
        allow="clipboard-read; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
