import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.clawdex.wallet',
  appName: 'ClawDEX',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
