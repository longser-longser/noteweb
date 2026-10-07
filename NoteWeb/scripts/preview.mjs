/**
 * 预览打包结果 —— 起一个极简服务器，专门看 dist 文件夹长什么样。
 * 用来在上传之前确认「打包出来的网站」是好的（这一步不读原始笔记）。
 *
 * 用法：  node scripts/build.mjs  &&  node scripts/preview.mjs
 */
import http from 'node:http'
import fs, { promises as fsp } from 'node:fs'
import { join, extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { once } from 'node:events'
import { config } from '../config.mjs'

const argv = process.argv.slice(2)
const portArg = argv.find((a) => a.startsWith('--port='))
const PORT = Number(portArg ? portArg.slice(7) : config.port + 1)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = config.distDir

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

if (!fs.existsSync(DIST)) {
  console.error('✗ 还没有 dist 文件夹。先执行：node scripts/build.mjs')
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '')
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    if (rel.split(sep).some((p) => p === '..')) {
      res.writeHead(403); return res.end('forbidden')
    }
    const target = join(DIST, rel)
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': MIME['.txt'] })
      return res.end('404 找不到：' + rel)
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' })
    res.end(await fsp.readFile(target))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': MIME['.txt'] })
    res.end(String(err.message || err))
  }
})

server.listen(PORT, '127.0.0.1')
await once(server, 'listening')
console.log('')
console.log(`  预览打包结果：http://localhost:${PORT}`)
console.log(`  （看的是 ${DIST} 里的成品，注意这里改笔记不会生效）`)
console.log('  停止：Ctrl + C')
console.log('')
