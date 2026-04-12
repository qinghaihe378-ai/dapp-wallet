/**
 * 将 longxia/web 的 Vite 产物拷入主站 dist/longxia（与子路径 /longxia/ 对应）
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'longxia/web/dist')
const dest = resolve(root, 'dist/longxia')

if (!existsSync(src)) {
  console.error('[copy-longxia-dist] 缺少 longxia/web/dist，请先完成 longxia/web 构建')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-longxia-dist] 已复制到 dist/longxia')
