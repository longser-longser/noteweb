/**
 * Markdown 渲染器。
 *
 * 用的是 markdown-it（完整支持表格、代码块、引用、任务列表等），
 * 代码高亮用 highlight.js。两个库都已经下载到 web/vendor/，
 * 所以整个网站不联网也能正常工作。
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { config } from '../config.mjs'

const require = createRequire(import.meta.url)
const MarkdownIt = require(join(config.webDir, 'vendor', 'markdown-it.umd.min.js'))
const hljs = require(join(config.webDir, 'vendor', 'highlight.min.js'))

/** highlight.js 能识别的语言名（用于页面提示；不认识的语言会原样显示，不会报错） */
export const LANGUAGES = hljs.listLanguages()

/** 把 & < > " 转义，避免代码里的符号破坏 HTML */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 反过来：把 HTML 实体还原成普通字符（提取标题文字时要用，否则会出现双重转义的 &quot;） */
export function decodeEntities(str) {
  return String(str)
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  // 注意：不要打开 typographer。它会先把 " 变成弯引号，
  // 导致 `**变量一**和"变量二"` 这类紧挨着中文引号的加粗语法解析失败（星号会原样显示出来）。
  typographer: false,
  breaks: false,
  highlight(code, lang) {
    const name = String(lang || '').trim().split(/[\s:]/)[0].toLowerCase()
    const inner =
      name && hljs.getLanguage(name)
        ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value
        : escapeHtml(code)
    const label = name ? `<span class="code-lang">${escapeHtml(name)}</span>` : ''
    return (
      `<div class="code-block">${label}` +
      `<button class="code-copy" type="button" data-copy>复制</button>` +
      `<pre class="hljs"><code>${inner}</code></pre></div>`
    )
  },
})

/** 生成标题锚点：英文数字直接留，中文保留，其它符号变连字符 */function headingId(text, used) {
  const base =
    String(text || '')
      .toLowerCase()
      .replace(/[`*_~[\]()!]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\-_.]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  const n = (used.get(base) || 0) + 1
  used.set(base, n)
  return n > 1 ? `${base}-${n}` : base
}

/**
 * 把 markdown 转成可插入页面的 HTML 片段。
 * - 去掉正文开头那个一级标题（页面上标题会单独显示，避免重复）
 * - 给所有标题自动生成 id，方便跳转到具体段落
 */
export function renderMarkdown(markdown) {
  const src = String(markdown).replace(/^\uFEFF/, '')
  const tokens = md.parse(src, {})

  // 只在最外层找一个一级标题，找到就整段删掉（连带它的内容和收尾标记）
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'heading_open' && t.tag === 'h1' && t.level === 0) {
      let close = i + 1
      while (close < tokens.length && tokens[close].type !== 'heading_close') close++
      tokens.splice(i, close - i + 1)
      break
    }
    if (t.level === 0 && t.type !== 'heading_open' && t.type !== 'heading_close') break
  }

  const html = md.renderer.render(tokens, md.options, {})

  // 给每个标题加上 id（已经手写了 id 的标题保持原样）
  const used = new Map()
  const withIds = html.replace(/<h([1-6])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g, (whole, level, attrs, inner) => {
    if (/\sid\s*=/.test(attrs)) return whole
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ''))
    return `<h${level}${attrs} id="${escapeHtml(headingId(text, used))}">${inner}</h${level}>`
  })

  return repairBold(withIds)
}

/**
 * 补救「中文标点旁边的加粗」。
 *
 * Markdown 标准规定：结束用的 ** 后面必须还有内容（右邻接规则），
 * 所以 `**"变量一"可以放心重新赋值了**。` 这种以中文句号结尾的写法，
 * 官方解析器会直接放弃解析，把星号原样显示出来。
 * 中文笔记里这种写法很常见（本次 13 篇里有 6 篇、约 37 处），
 * 所以这里做一次收尾处理：把同一行内成对残留的 ** 补成 <strong>。
 */
function repairBold(html) {
  if (!html.includes('**')) return html

  // 代码块和行内代码里的 ** 是代码本身，绝不能动：
  // 先用「像 HTML 标签一样的占位符」把它们换掉，这样后面的标签扫描会自然跳过它们。
  const stash = []
  const holder = (m) => {
    const n = stash.push(m) - 1
    return `<x-stash-${n}/>`
  }
  const s2 = html.replace(/<pre[\s\S]*?<\/pre>/g, holder).replace(/<code[\s\S]*?<\/code>/g, holder)

  // 逐字符标记「哪一段是 HTML 标签」，之后只在标签外面找成对的 **
  let s = s2
  let isTag = new Uint8Array(s.length)
  for (const t of s.matchAll(/<[^>]*>/g)) isTag.fill(1, t.index, t.index + t[0].length)
  const open = (i) => !isTag[i] && s[i] === '*' && s[i + 1] === '*' && !isTag[i + 1]
  const OUT = '<strong>'
  const END = '</strong>'

  let i = 0
  let guard = 0
  while (i < s.length - 1 && guard < 5000) {
    while (i < s.length - 1 && !open(i)) i++
    if (i >= s.length - 1) break

    // 往后找结束的 **（不能跨空行/换行，避免张冠李戴）
    let j = i + 2
    let close = -1
    let len = 0
    while (j < s.length - 1 && len <= 800) {
      if (s[j] === '\n') break
      if (open(j)) { close = j; break }
      len++
      j++
    }

    if (close === -1) { i += 2; continue }

    const inner = s.slice(i + 2, close)
    if (!inner || inner.length > 800) { i += 2; continue }

    s = s.slice(0, i) + OUT + inner + END + s.slice(close + 2)
    // 替换后长度变了，标签标记表也要跟着移动
    const shift = OUT.length + END.length - 4
    const next = new Uint8Array(s.length)
    next.set(isTag.subarray(0, i), 0)
    next.set(isTag.subarray(i + 4, close + 2), i + OUT.length)
    next.set(isTag.subarray(close + 2), close + 2 + shift)
    isTag = next

    i = i + OUT.length + inner.length + END.length
    guard++
  }

  return s.replace(/<x-stash-(\d+)\/>/g, (m, idx) => stash[Number(idx)])
}

/** 从渲染结果里抽出二、三级标题，用于生成「本页目录」 */
export function extractHeadings(html) {
  const out = []
  const re = /<h([23])(?:\s[^>]*)?\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
  let m
  while ((m = re.exec(html)) && out.length < 200) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (text) out.push({ level: Number(m[1]), id: m[2], text })
  }
  return out
}
