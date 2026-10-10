/**
 * 静态打包 —— 生成一堆纯网页文件，可以上传到 GitHub Pages、Vercel 等任何静态托管，
 * 得到一个「关掉电脑也能访问」的永久网址。
 *
 * 用法：  node scripts/build.mjs
 * 输出：  NoteWeb/dist/        （整个文件夹就是网站，上传它就行）
 *
 * 注意：打包之后再改笔记，需要重新跑一次这个命令，然后重新上传。
 *       只是想在局域网里给同学看的话，不需要打包，直接 node scripts/serve.mjs 更方便。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config.mjs'
import { buildManifest } from './manifest.mjs'
import { renderMarkdown, extractHeadings } from './renderer.mjs'
import { renderPage, buildNav, indexNotes, notesHref, musicPageBody } from './site.mjs'
import { ensureMusicLibrary } from './music-scan.mjs'

const DIST = config.distDir

/** 递归复制文件夹 */
async function copyTree(from, to, filter = () => true) {
  await fs.mkdir(to, { recursive: true })
  let entries
  try { entries = await fs.readdir(from, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const src = join(from, e.name)
    const dst = join(to, e.name)
    if (e.isDirectory()) await copyTree(src, dst, filter)
    else if (e.isFile() && filter(e.name)) await fs.copyFile(src, dst)
  }
}

async function main() {
  console.log('开始打包…')
  const assets = '../'
  const themeLinks = `<link rel="stylesheet" href="${assets}vendor/hljs-github.css" data-hljs-theme="light" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="${assets}vendor/hljs-github-dark.css" data-hljs-theme="dark" media="(prefers-color-scheme: dark)">`
  const manifest = await buildManifest()
  const notes = indexNotes(manifest.notes)
  const withNotes = { ...manifest, notes }

  // 曲库清单：只扫描 music 文件夹里新增/变化过的文件（有缓存，不会每次都重新分析）
  //
  // NW_NO_MUSIC=1 时不碰曲库，直接打包成「没有音乐」的轻量版。
  // 用途：Netlify Drop / Cloudflare Pages 这类手动上传的托管对体积很敏感
  // （官方建议整个站点 50 MB 以内、单个文件 10 MB 以内，几十 MB 的 FLAC 会让部署卡死），
  // 而且很多人只想把「笔记」放上网、音频留在本地听。
  const noMusic = process.env.NW_NO_MUSIC === '1'
  const music = noMusic
    ? { count: 0, tracks: [], totalBytes: 0, totalDuration: 0, formats: {}, playable: 0, lossless: 0, withCover: 0 }
    : await ensureMusicLibrary()
  const hasMusic = music.count > 0

  // 1) 清空并重建输出目录
  await fs.rm(DIST, { recursive: true, force: true })
  await fs.mkdir(join(DIST, 'n'), { recursive: true })

  // 2) 网页资源（css / js / vendor）
  await copyTree(config.webDir, DIST, (name) => name !== 'notes.js')

  // 2.1) 轻量版用不到播放器资源（player.js / player.css / 从音频里抽出来的封面）
  if (noMusic) await fs.rm(join(DIST, 'music'), { recursive: true, force: true })

  // 3) 附录：把原始 md 也复制过去，方便直接下载 / 引用
  const mdPrefix = '../md/'
  for (const n of notes) {
    const src = join(config.notesDir, n.path)
    const dst = join(DIST, 'md', n.path)
    await fs.mkdir(join(dst, '..'), { recursive: true })
    await fs.copyFile(src, dst)
  }
  // 同时复制图片等资源，保证 md 里的相对路径图片也能显示
  await copyTree(config.notesDir, join(DIST, 'md'), (name) => !/\.(md|markdown|mdown|mkd)$/i.test(name))

  // 4) 每篇笔记 → 一个 HTML 文件
  //    注意：笔记页在 dist/n/ 里面，所以资源相对自己是 ../，站内其它笔记是 ../n/
  const nav = buildNav(notes, '../n/')
  let count = 0
  for (const note of notes) {
    const md = await fs.readFile(join(config.notesDir, note.path), 'utf8')
    const content = renderMarkdown(md)
    const html = renderPage({
      title: `${note.title} · ${config.siteTitle}`,
      manifest: withNotes,
      note,
      current: note.index,
      assets: '../',
      urlPrefix: '../n/',
      nav,
      content,
      headings: extractHeadings(content),
      live: false,
      themeLinks,
      music: music.count,
    })
    await fs.writeFile(join(DIST, 'n', `${note.slug}.html`), html, 'utf8')
    count++
  }

  // 5) 首页（在 dist 根目录，所以侧边栏链接要指到 n/ 里面）
  const homeNav = buildNav(notes, './n/')
  const home = renderPage({
    title: `${config.siteTitle} · 首页`,
    manifest: withNotes,
    current: -1,
    assets: './',
    urlPrefix: './n/',
    nav: homeNav,
    themeLinks,
    // 这里传的是歌曲数而不是 true/false：首页卡片的"N 首"要显示真实数量
    music: music.count,
  })
  await fs.writeFile(join(DIST, 'index.html'), home, 'utf8')

  // 5.5) 音乐库页面 + 音频文件 + 浏览器要读的曲库清单
  if (hasMusic) {
    // 音频按原样复制，不转码、不降码率；清单里的路径在网页里是 ./music/<file>
    const embedTracks = []
    for (const t of music.tracks) {
      const src = join(config.musicDir, t.file)
      const dst = join(DIST, 'music', t.file)
      await fs.mkdir(join(dst, '..'), { recursive: true })
      try { await fs.copyFile(src, dst) } catch { /* 读不到就跳过复制，清单照旧保留 */ }
      embedTracks.push({ ...t, file: t.file })
    }
    const embedLib = { ...music, tracks: embedTracks }
    await fs.writeFile(join(DIST, 'music', 'library.json'), JSON.stringify(embedLib, null, 2), 'utf8')

    const mainHtml = musicPageBody(music, { homeHref: '../' })
    const musicPage = renderPage({
      title: `音乐库 · ${config.siteTitle}`,
      manifest: withNotes,
      current: -1,
      // 音乐库页面在 dist/music/ 里，比根目录深一层，所以资源前缀要用 ../
      assets: '../',
      urlPrefix: '../n/',
      nav: buildNav(notes, '../n/'),
      themeLinks,
      mainHtml,
      music: music.count,
    })
    await fs.writeFile(join(DIST, 'music', 'index.html'), musicPage, 'utf8')
  }

  // 6) 首页搜索用的清单（浏览器打开时按需加载，服务器模式下用不到）
  const index = notes.map((n) => ({
    course: n.course,
    title: n.title,
    excerpt: n.excerpt,
    href: notesHref('./n/', n),
  }))
  await fs.writeFile(join(DIST, 'notes.js'), `window.__NOTES__ = ${JSON.stringify(index)};\n`, 'utf8')

  // 7) GitHub Pages 需要的标记文件 + 给搜索引擎的说明
  await fs.writeFile(join(DIST, '.nojekyll'), '', 'utf8')
  await fs.writeFile(join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8')

  // 8) 检查有没有漏掉的链接
  console.log('')
  console.log(`✓ 打包完成：${count} 篇笔记`)
  if (hasMusic) console.log(`✓ 音乐库：${music.count} 首，${(music.totalBytes / 1024 / 1024).toFixed(1)} MB（原样复制，未转码）`)
  if (noMusic) console.log('✓ 轻量版：按 NW_NO_MUSIC=1 打包，没有包含音乐库（适合上传到 Netlify 等有体积限制的托管）')
  console.log(`✓ 输出目录：${DIST}`)
  console.log('')
  console.log('  预览打包结果（本地起个临时服务器）：')
  console.log('     node scripts/preview.mjs')
  console.log('')
  console.log('  要发布到网上：把 dist 文件夹里的内容整体上传即可（详见 README.md）')
}

main().catch((err) => {
  console.error('✗ 打包失败：', err?.message || err)
  process.exit(1)
})
