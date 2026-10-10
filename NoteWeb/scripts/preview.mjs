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
  // 音频（音乐库里是原始文件，原样送出，不转码）
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
}

if (!fs.existsSync(DIST)) {
  console.error('✗ 还没有 dist 文件夹。先执行：node scripts/build.mjs')
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '')
    // 注意：Windows 上 normalize('music/') 会变成 'music\\'，所以结尾要同时认 / 和 \
    if (rel === '' || /[/\\]$/.test(rel)) rel += 'index.html'
    if (rel.split(sep).some((p) => p === '..')) {
      res.writeHead(403); return res.end('forbidden')
    }
    const target = join(DIST, rel)
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': MIME['.txt'] })
      return res.end('404 找不到：' + rel)
    }
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
    // 支持 Range：音频要能拖动进度条，跟正式静态托管（Netlify / GitHub Pages）行为一致
    const range = req.headers.range
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      let start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1])
      let end = m[1] === '' || m[2] === '' ? stat.size - 1 : Number(m[2])
      if (isNaN(start) || start < 0 || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
        return res.end()
      }
      end = Math.min(end, stat.size - 1)
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      })
      return fs.createReadStream(target, { start, end }).pipe(res)
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size })
    fs.createReadStream(target).pipe(res)
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
