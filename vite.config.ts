import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.UNISWAP_API_KEY || env.VITE_UNISWAP_API_KEY

  return {
    base: './',
    plugins: [react()],
    server: {
      proxy: {
        '/api/uniswap': {
          target: 'https://trade-api.gateway.uniswap.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/uniswap/, '/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('x-api-key', apiKey)
              proxyReq.setHeader('x-universal-router-version', '2.0')
              proxyReq.setHeader('x-permit2-disabled', 'true')
            })
          },
        },
      },
    },
  }
})
