/**
 * 本地服务器 —— 一条命令把笔记变成网站。
 *
 * 用法：
 *   node scripts/serve.mjs                 默认端口 5173，局域网内其他人也能访问
 *   node scripts/serve.mjs --port=8080     换端口
 *   node scripts/serve.mjs --local         只有本机能访问（更安全）
 *   node scripts/serve.mjs --slow          不开启自动刷新（老机器上更省资源）
 *
 * 特点：笔记一旦改动，浏览器会自动刷新，不用手动按 F5。
 */
import http from 'node:http'
import fs, { promises as fsp } from 'node:fs'
import { join, extname, normalize, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { networkInterfaces } from 'node:os'
import { spawn } from 'node:child_process'
import { config } from '../config.mjs'
import { buildManifest } from './manifest.mjs'
import { renderMarkdown, extractHeadings } from './renderer.mjs'
import { renderPage, buildNav, indexNotes, musicPageBody } from './site.mjs'
import { ensureMusicLibrary } from './music-scan.mjs'

/* ------------------------------- 参数解析 ------------------------------- */
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const PORT = Number(value('port', process.env.PORT || config.port))
const HOST = has('--local') ? '127.0.0.1' : value('host', config.host)
const LIVE = !has('--slow')

/* ------------------------------- 笔记状态 ------------------------------- */
let manifest = null
let dirty = true
let rebuilding = null

/** （重新）扫描笔记文件夹 */
async function rebuild(reason) {
  if (rebuilding) return rebuilding
  rebuilding = (async () => {
    try {
      manifest = await buildManifest()
      dirty = false
      if (reason) console.log(`   ↻ 已重新读取笔记（${reason}）：共 ${manifest.count} 篇`)
    } catch (err) {
      console.error('   ✗ 读取笔记失败：', err.message)
    } finally {
      rebuilding = null
    }
  })()
  return rebuilding
}

/** 读取清单（必要时先重建） */
async function getManifest() {
  if (!manifest || dirty) await rebuild()
  return manifest
}

/* ------------------------- 监听笔记文件夹变化 ------------------------- */
const sseClients = new Set()

function broadcast() {
  for (const res of sseClients) {
    try { res.write('event: changed\ndata: 1\n\n') } catch (e) { sseClients.delete(res) }
  }
}

let timer = null
const schedule = () => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    await rebuild('文件有改动')
    broadcast()
  }, 250)
}

function startWatcher() {
  if (!LIVE) return null
  try {
    const w = fs.watch(config.notesDir, { recursive: true }, (event, file) => {
      if (!file) return schedule()
      if (/\.(md|markdown|mdown|mkd|png|jpe?g|gif|webp|svg)$/i.test(String(file))) schedule()
    })
    console.log('   👀 已开启实时监听：改完笔记保存，网页会自动刷新')
    return w
  } catch (err) {
    console.log('   ⚠ 无法开启文件监听（' + (err.message || err) + '），改完笔记请手动按 F5')
    return null
  }
}

/* ------------------------------- 工具函数 ------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.mdown': 'text/markdown; charset=utf-8',
  '.mkd': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
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

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(body)
}

async function readIfFile(root, relPath) {
  const clean = normalize(decodeURIComponent(relPath)).replace(/^([/\\])+/, '')
  if (clean.split(sep).some((p) => p === '..')) return null
  const target = join(root, clean)
  if (!target.startsWith(root)) return null
  const stat = await fsp.stat(target).catch(() => null)
  if (!stat || !stat.isFile()) return null
  return { target, stat }
}

function html(res, body, code = 200) {
  send(res, code, body, { 'Content-Type': MIME['.html'] })
}

/**
 * 音频文件：支持 Range 请求（浏览器拖进度条、跳过一段都靠它），
 * 否则 <audio> 拿不到 206 就没法定位播放。
 */
function sendMedia(req, res, found) {
  const { target, stat } = found
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
  const total = stat.size
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
    if (m) {
      let start = m[1] === '' ? null : Number(m[1])
      let end = m[2] === '' ? null : Number(m[2])
      if (start === null && end !== null) { start = Math.max(0, total - end); end = total - 1 }
      else {
        if (start === null) start = 0
        if (end === null || end >= total) end = total - 1
      }
      if (!isFinite(start) || !isFinite(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' })
        return res.end()
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(target, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(target).pipe(res)
}

/** 一个简单的提示页（404 等） */
function noticePage(title, lines, code) {
  const body = lines.map((l) => `<p>${l}</p>`).join('')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="/css/style.css"></head>
<body><main class="article"><h1 class="article-title" style="margin-top:12vh">${title}</h1>
<div class="article-body">${body}</div></main></body></html>`
}

/* ------------------------------- 路由处理 ------------------------------- */
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  /* --- 自动刷新用的长连接 --- */
  if (pathname === '/__live') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    sseClients.add(res)
    const ping = setInterval(() => {
      try { res.write(': ping\n\n') } catch (e) {}
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      sseClients.delete(res)
    })
    return
  }

  /* --- 单篇笔记（服务器渲染，浏览器拿到的是完整网页） --- */
  if (pathname === '/note') {
    const rel = url.searchParams.get('p')
    if (!rel) return send(res, 400, 'missing ?p=', { 'Content-Type': MIME['.txt'] })
    const found = await readIfFile(config.notesDir, rel)
    if (!found) {
      return html(res, noticePage('找不到这篇笔记', [`请求的路径：<code>${rel}</code>`, '<a href="/">← 返回首页</a>'], 404), 404)
    }
    const md = await fsp.readFile(found.target, 'utf8')
    const mf = await getManifest()
    const notes = indexNotes(mf.notes)
    const wanted = String(rel).split(sep).join('/')
    const note = notes.find((n) => n.path === wanted)
    if (!note) {
      return html(res, noticePage('这篇笔记不在清单里', ['请在 NoteWeb 文件夹里执行：<code>node scripts/sync-notes.mjs</code>', '<a href="/">← 返回首页</a>'], 404), 404)
    }
    const content = renderMarkdown(md)
    const page = renderPage({
      title: `${note.title} · ${config.siteTitle}`,
      manifest: { ...mf, notes },
      note,
      current: note.index,
      assets: '/',
      urlPrefix: '/note?p=',
      nav: buildNav(notes, '/note?p='),
      content,
      headings: extractHeadings(content),
      live: LIVE,
      port: PORT,
      music: (await ensureMusicLibrary()).count,
    })
    return html(res, page)
  }

  /* --- 直接看原始 md 文件（浏览器里当纯文本显示，不会触发下载） --- */
  if (pathname.startsWith('/raw/')) {
    const found = await readIfFile(config.notesDir, pathname.slice('/raw/'.length))
    if (!found) return send(res, 404, 'not found', { 'Content-Type': MIME['.txt'] })
    const ext = extname(found.target).toLowerCase()
    return send(res, 200, await fsp.readFile(found.target), {
      'Content-Type': MIME[ext] || 'text/plain; charset=utf-8',
    })
  }

  /* --- 音乐库：页面、曲库清单、音频文件 --- */
  if (pathname === '/music/library.json') {
    const lib = await ensureMusicLibrary()
    return send(res, 200, JSON.stringify(lib), { 'Content-Type': MIME['.json'] })
  }
  if (pathname === '/music' || pathname === '/music/') {
    const lib = await ensureMusicLibrary()
    const mf = await getManifest()
    const notes = indexNotes(mf.notes)
    const page = renderPage({
      title: `音乐库 · ${config.siteTitle}`,
      manifest: { ...mf, notes },
      current: -1,
      assets: '/',
      urlPrefix: '/note?p=',
      nav: buildNav(notes, '/note?p='),
      live: LIVE,
      port: PORT,
      mainHtml: musicPageBody(lib, { homeHref: '/' }),
      music: lib.count,
    })
    return html(res, page)
  }
  if (pathname.startsWith('/music/')) {
    // 音频按原文件发送（支持 Range）；找不到就走下面的 web 静态资源（player.js / css / 封面）
    const found = await readIfFile(config.musicDir, pathname.slice('/music/'.length))
    if (found) return sendMedia(req, res, found)
  }

  /* --- 其它静态资源（css / js / 图片） --- */
  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    const mf = await getManifest()
    const notes = indexNotes(mf.notes)
    const lib = await ensureMusicLibrary()
    const page = renderPage({
      title: `${config.siteTitle} · 首页`,
      manifest: { ...mf, notes },
      current: -1,
      assets: '/',
      urlPrefix: '/note?p=',
      nav: buildNav(notes, '/note?p='),
      music: lib.count,
    })
    return html(res, page)
  }

  const found = await readIfFile(config.webDir, pathname)
  if (found) {
    const ext = extname(found.target).toLowerCase()
    return send(res, 200, await fsp.readFile(found.target), {
      'Content-Type': MIME[ext] || 'application/octet-stream',
    })
  }

  return html(res, noticePage('页面不存在', ['<a href="/">← 返回首页</a>'], 404), 404)
}

/* ------------------------------- 启动 ------------------------------- */
function lanAddresses() {
  const out = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address })
    }
  }
  return out
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('请求出错：', err)
    if (!res.headersSent) send(res, 500, '服务器内部错误：' + (err.message || err), { 'Content-Type': MIME['.txt'] })
    else res.end()
  })
})

async function main() {
  if (!fs.existsSync(config.notesDir)) {
    console.log('⚠ 还没有笔记副本，正在从来源文件夹同步…\n')
    await new Promise((resolve, reject) => {
      const syncScript = join(dirname(fileURLToPath(import.meta.url)), 'sync-notes.mjs')
      const child = spawn(process.execPath, [syncScript], { stdio: 'inherit' })
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('同步失败'))))
    })
  }

  await rebuild()
  startWatcher()

  server.listen(PORT, HOST)
  await once(server, 'listening')
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n✗ 端口 ${PORT} 已被占用。换一个端口再试，例如：\n   node scripts/serve.mjs --port=${PORT + 1}\n`)
    } else {
      console.error('✗ 服务器出错：', err.message)
    }
    process.exit(1)
  })

  const lan = lanAddresses()
  console.log('')
  console.log('  ╭──────────────────────────────────────────────╮')
  console.log('  │  笔记网站已经跑起来了                        │')
  console.log('  ╰──────────────────────────────────────────────╯')
  console.log('')
  console.log(`  本机打开：      http://localhost:${PORT}`)
  if (HOST !== '127.0.0.1' && lan.length) {
    console.log('')
    console.log('  发给同学用这些地址（需连同一个 WiFi / 校园网）：')
    for (const n of lan) console.log(`      http://${n.address}:${PORT}    （网卡：${n.name}）`)
    console.log('')
    console.log('  如果同学打不开，多半是 Windows 防火墙拦了，用管理员身份运行一次：')
    console.log(`      netsh advfirewall firewall add rule name="NoteWeb ${PORT}" dir=in action=allow protocol=TCP localport=${PORT}`)
  } else if (HOST === '127.0.0.1') {
    console.log('  （当前是 --local 模式，只有本机能访问）')
  }
  console.log('')
  console.log(`  共 ${manifest?.count ?? 0} 篇笔记。改完 md 保存，网页会自动刷新。`)
  console.log('  停止服务器：在本窗口按 Ctrl + C')
  console.log('')
}

main().catch((err) => {
  console.error('✗ 启动失败：', err?.message || err)
  process.exit(1)
})
