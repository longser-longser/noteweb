/**
 * 页面骨架：把「侧边栏 + 正文」拼成一整页 HTML。
 * 本地服务器和静态打包脚本都调用这里，保证两种模式下长得一模一样。
 */
import { config } from '../config.mjs'

export const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** 给清单里的每篇笔记补上序号（侧边栏高亮要用） */
export function indexNotes(notes) {
  return notes.map((n, index) => (n.index === index ? n : { ...n, index }))
}

/**
 * 笔记链接前缀：
 *   本地服务器模式  →  '/note?p='              拼出来是 /note?p=linux操作系统/xxx.md
 *   静态部署模式    →  '../n/'（来自某篇笔记页） 拼出来是 ../n/xxx.html
 */
export function notesHref(prefix, note) {
  if (prefix.endsWith('?p=')) return prefix + encodeURIComponent(note.path).replace(/%2F/g, '/')
  return prefix + note.slug + '.html'
}

/**
 * @param {object} page
 * @param {string} page.title      浏览器标签页标题
 * @param {object} page.manifest   清单
 * @param {object|null} page.note  当前笔记
 * @param {number} page.current    当前笔记序号（-1 表示首页）
 * @param {string} page.assets     静态资源前缀：本地模式 '/'，静态模式 '../'
 * @param {string} page.urlPrefix  笔记链接前缀（见 notesHref）
 * @param {Array}  page.nav        侧边栏分组
 * @param {string} page.content    正文 HTML
 * @param {Array}  page.headings   本页目录
 * @param {boolean} page.live      是否开启「改完自动刷新」
 * @param {number} page.port       服务器端口
 * @param {string} page.themeLinks 代码高亮主题的两个 <link>（本地/静态两种模式路径不同）
 * @param {string|null} page.mainHtml 自定义正文（音乐库页用；给了它就忽略 note/home）
 * @param {number} page.music     曲库歌曲数（0 = 不显示「音乐库」入口，>0 时首页卡片显示"N 首"）
 */
export function renderPage(page) {
  const {
    title,
    manifest,
    note = null,
    current = -1,
    assets = '/',
    urlPrefix = '/note?p=',
    nav = [],
    content = '',
    headings = [],
    live = false,
    port = config.port,
    mainHtml = null,
    music = false,
    themeLinks = `<link rel="stylesheet" href="${assets}vendor/hljs-github.css" data-hljs-theme="light" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="${assets}vendor/hljs-github-dark.css" data-hljs-theme="dark" media="(prefers-color-scheme: dark)">`,
  } = page

  const desc = note ? String(note.excerpt || '').slice(0, 120) : `${config.siteTitle} · 共 ${manifest.count} 篇笔记`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<script>(function(){try{var t=localStorage.getItem('noteweb-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.dataset.theme='dark';}catch(e){}})();</script>
<link rel="icon" href="${assets}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${assets}css/style.css">
${music ? `<link rel="stylesheet" href="${assets}music/player.css">\n` : ''}${themeLinks}
</head>
<body data-auto-refresh="${live ? '1' : '0'}" data-port="${esc(port)}">

<div class="progress" id="progress"></div>

<header class="topbar">
  <button class="icon-btn" id="menu-btn" type="button" aria-label="打开目录">☰</button>
  <a class="brand" href="${assets}">${esc(config.siteTitle)}</a>
  <span class="topbar-spacer"></span>
  <span class="topbar-count">${manifest.count} 篇</span>
  <button class="icon-btn" id="theme-btn" type="button" aria-label="切换深色模式">🌙</button>
</header>

<aside class="sidebar" id="sidebar">
  <div class="sidebar-head">
    <a class="site-title" href="${assets}">${esc(config.siteTitle)}</a>
    ${manifest.count ? `<div class="site-tagline">录音整理 · ${manifest.count} 篇</div>` : (config.siteTagline ? `<div class="site-tagline">${esc(config.siteTagline)}</div>` : '')}
  </div>
  <div class="side-row">
    <button class="theme-toggle" id="theme-btn" type="button" aria-label="切换深色模式">
      <span class="theme-icon">🌙</span><span class="theme-label">深色模式</span>
    </button>
    <a class="side-link" href="${assets}">首页</a>
    ${music ? `<a class="side-link side-link-music" href="${assets}music/">音乐库</a>` : ''}
  </div>
  <div class="search-wrap">
    <input id="search" class="search" type="search" placeholder="搜索笔记标题…（按 / 快速定位）" autocomplete="off" spellcheck="false">
    <div class="search-count" id="search-count"></div>
  </div>
  <nav class="nav" id="nav">
${nav
  .map(
    (group, gi) => `    <section class="nav-group" data-group="${gi}">
      <button class="nav-course" type="button"><span class="chev">▸</span><span class="nav-course-name">${esc(group.course)}</span><span class="nav-course-count">${group.items.length}</span></button>
      <ul class="nav-list">
${group.items
  .map(
    (it) =>
      `        <li${it.note.index === current ? ' class="active"' : ''}><a href="${esc(it.href)}" data-text="${esc((it.label + ' ' + group.course).toLowerCase())}">${esc(it.label)}</a></li>`
  )
  .join('\n')}
      </ul>
    </section>`
  )
  .join('\n')}
    <div class="nav-empty" id="nav-empty" hidden>没有匹配的笔记</div>
  </nav>
  <div class="sidebar-foot">
    <span>共 ${manifest.count} 篇笔记</span>
  </div>
${music ? '  <p class="foot-disclaimer">音乐版权归原作者及发行方所有，本站仅供个人学习试听，请勿转载传播。</p>\n' : ''}</aside>

<div class="scrim" id="scrim" hidden></div>

<main class="main">
${mainHtml != null ? mainHtml : note ? renderArticle({ note, content, headings, manifest, live, urlPrefix, assets }) : renderHome({ manifest, nav, assets, music })}
</main>

<div class="to-top" id="to-top" hidden title="回到顶部">↑</div>

<script src="${assets}js/app.js"></script>
${music ? `<script src="${assets}music/player.js" data-music-base="${assets}music/" data-site-base="${assets}"></script>\n` : ''}</body>
</html>
`
}

function renderArticle({ note, content, headings, manifest, live, urlPrefix, assets }) {
  const order = manifest.notes
  const i = order.findIndex((n) => n.path === note.path)
  const prev = i > 0 ? order[i - 1] : null
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null
  const toc = headings.length >= 4
  // 原始 md 文件的位置：本地服务器在 /raw/，静态打包在 ../md/
  const rawPrefix = urlPrefix.endsWith('?p=') ? '/raw/' : '../md/'

  return `  <article class="article" id="article">
    <nav class="crumbs"><a href="${assets}">首页</a><span class="sep">/</span><span>${esc(note.course)}</span></nav>
    <header class="article-head">
      <h1 class="article-title">${esc(note.title)}</h1>
      <div class="article-meta">
        <span class="tag">${esc(note.course)}</span>
        <span>${esc(note.updated)}</span>
        <span class="dot">·</span>
        <span>约 ${note.words} 字</span>
        ${live ? '<span class="live-badge" id="live-badge" title="笔记文件改动后页面会自动刷新">实时</span>' : ''}
      </div>
    </header>
${toc ? renderToc(headings) : ''}
    <div class="article-body">
${content}
    </div>
    <nav class="pager">
      ${prev ? `<a class="pager-prev" href="${esc(notesHref(urlPrefix, prev))}"><span>上一篇</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
      ${next ? `<a class="pager-next" href="${esc(notesHref(urlPrefix, next))}"><span>下一篇</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
    </nav>
    <p class="md-link">这篇笔记的原始 Markdown 文件：<a href="${esc(rawPrefix + encodeURI(note.path))}">${esc(note.path)}</a>（浏览器会直接显示内容）</p>
  </article>`
}

function renderToc(headings) {
  return `    <details class="toc" open>
      <summary>本页目录 <span class="toc-count">${headings.length}</span></summary>
      <ul>
${headings.map((h) => `        <li class="lv${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('\n')}
      </ul>
    </details>`
}

function renderHome({ manifest, nav, assets = '/', music = 0 }) {
  const musicCard = music
    ? `      <section class="home-card home-card-music">
        <h2>音乐库<span class="home-card-count">${music} 首</span></h2>
        <ul>
          <li><a href="${assets}music/"><span class="home-item-title">打开音乐库</span><span class="home-item-meta">曲库清单 · 全站底部播放条</span></a></li>
        </ul>
        <p class="home-card-note">音乐版权归原作者及发行方所有，本站仅供个人学习整理与试听，请勿转载传播。</p>
      </section>
`
    : ''
  return `  <div class="home">
    <header class="home-head">
      <h1>${esc(config.siteTitle)}</h1>
      <p class="home-sub">共 ${manifest.count} 篇笔记 · ${nav.length} 个分类 · 整理自课堂录音</p>
    </header>
    <div class="home-grid">
${musicCard}${nav
  .map(
    (g) => `      <section class="home-card">
        <h2>${esc(g.course)}<span class="home-card-count">${g.items.length} 篇</span></h2>
        <ul>
${g.items
  .map(
    (it) => `          <li><a href="${esc(it.href)}"><span class="home-item-title">${esc(it.label)}</span><span class="home-item-meta">约 ${it.note.words} 字 · ${esc(it.note.updated.slice(0, 10))}</span></a></li>`
  )
  .join('\n')}
        </ul>
      </section>`
  )
  .join('\n')}
    </div>
    <p class="home-tip">提示：左侧可以直接搜索笔记标题；打开任意一篇后，右上角可以切换深色模式。</p>
  </div>`
}

/**
 * 音乐库页面的正文骨架（本地服务器与静态打包共用同一份，避免两处走样）。
 * 曲线数据由浏览器端的 player.js 读 library.json 后填进 #nw-library。
 */
export function musicPageBody(lib, { homeHref = '/' } = {}) {
  const meta = []
  meta.push(`共 ${lib.count || 0} 首`)
  const total = Math.round(lib.totalDuration || 0)
  if (total) {
    const hours = Math.floor(total / 3600)
    const mins = Math.floor((total % 3600) / 60)
    meta.push(hours ? `${hours} 小时 ${mins} 分` : `${mins} 分`)
  }
  if (lib.totalBytes) meta.push(`${(lib.totalBytes / 1048576).toFixed(1)} MB`)
  if (lib.formats && Object.keys(lib.formats).length) meta.push(Object.keys(lib.formats).join(' / '))
  return `  <div class="music-page">
    <nav class="crumbs"><a href="${esc(homeHref)}">首页</a><span class="sep">/</span><span>音乐库</span></nav>
    <header class="article-head">
      <h1 class="article-title">音乐库</h1>
      <div class="article-meta">
        <span class="tag">音乐</span>
${meta.map((m) => `        <span>${esc(m)}</span>`).join('\n        <span class="dot">·</span>\n')}
      </div>
    </header>
    <p class="nw-page-status" id="nw-music-status"></p>
    <div id="nw-library" class="nw-lib-page"></div>
  </div>`
}

/** 构建侧边栏分组数据 */
export function buildNav(notes, urlPrefix) {
  const groups = []
  const byCourse = new Map()
  for (const note of notes) {
    if (!byCourse.has(note.course)) {
      byCourse.set(note.course, { course: note.course, items: [] })
      groups.push(byCourse.get(note.course))
    }
    byCourse.get(note.course).items.push({ href: notesHref(urlPrefix, note), label: note.title, note })
  }
  return groups
}
