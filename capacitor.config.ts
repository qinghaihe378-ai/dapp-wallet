import type { CapacitorConfig } from '@capacitor/cli'

/** 与 .env.production 中 VITE_API_BASE 保持一致（无尾斜杠） */
const LIVE_SITE = 'https://ipfs-social-1a7l.vercel.app'

const config: CapacitorConfig = {
  appId: 'com.clawdex.wallet',
  appName: 'ClawDEX',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    /**
     * 直接加载线上站点，与网页版同源，避免 WebView 内打包页面跨域请求 /api 被 CORS 拦截。
     * 需联网；逻辑与部署站点一致，更新站点后 App 即使用新版前端（无需重装 APK 也可拿到新前端，视缓存而定）。
     */
    url: LIVE_SITE,
    cleartext: false,
  },
}

export default config
