/** 为本地 `serve dist` 写入 serve.json：仅 /longxia 下 SPA 回退；根路径用静态 dist/index.html（钱包）。 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
mkdirSync(dist, { recursive: true })

/**
 * 不要用 `** -> /index.html`：部分 serve 版本会把根路径 `/` 也重写到错误目标，
 * 出现「打开 localhost:3000/ 却是龙虾」的现象。
 *
 * 根路径由静态文件 dist/index.html（ClawDEX）直接提供；仅 /longxia 下做 SPA 回退。
 * 钱包其它前端路由在 preview 里可能 404，请用 `npm run dev` 测钱包。
 */
const cfg = {
  rewrites: [
    { source: '/longxia', destination: '/longxia/index.html' },
    { source: '/longxia/', destination: '/longxia/index.html' },
    { source: '/longxia/:path*', destination: '/longxia/index.html' }
  ]
}

writeFileSync(resolve(dist, 'serve.json'), JSON.stringify(cfg, null, 2))
console.log('[write-dist-serve-json] 已写入 dist/serve.json（用于 npm run preview:dist）')
