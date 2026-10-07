/**
 * 扫描 notes 文件夹，生成「笔记清单」（manifest.json）。
 *
 * 清单里记录了：每篇笔记属于哪个分类、标题是什么、多大、什么时候改的，
 * 以及一小段正文（给搜索用）。服务器和打包脚本都读这份清单。
 */
import { promises as fs } from 'node:fs'
import { join, relative, basename, extname, sep } from 'node:path'
import { config } from '../config.mjs'

export const NOTE_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd'])

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else if (e.isFile() && NOTE_EXT.has(extname(e.name).toLowerCase())) out.push(full)
  }
  return out
}

/**
 * 取出正文里第一个一级标题（# 标题）当作笔记标题。
 * 会跳过 ``` 代码块内部的行——否则代码里的 "# Step 1" 会被误认成标题。
 */
export function extractTitle(markdown, fileName) {
  const lines = String(markdown).replace(/^\uFEFF/, '').split(/\r?\n/)
  let inFence = false
  for (const line of lines) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = t.match(/^#\s+(.+?)\s*#*\s*$/)
    if (m && m[1].trim()) {
      return m[1].trim().replace(/[*_`~]/g, '').replace(/\s+/g, ' ')
    }
  }
  return basename(fileName, extname(fileName))
}

/** 把 md 语法去掉，得到纯文本，供搜索与摘要使用 */
export function plainText(markdown) {
  return String(markdown)
    .replace(/^\uFEFF/, '')
    .replace(/```[\s\S]*?```/g, ' ')          // 代码块
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]*)`/g, '$1')              // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // 链接 → 保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')      // 标题符号
    .replace(/^\s{0,3}>\s?/gm, ' ')           // 引用符号
    .replace(/^\s{0,3}[-*+]\s+/gm, ' ')       // 列表符号
    .replace(/^\s{0,3}\d+[.)]\s+/gm, ' ')     // 有序列表符号
    .replace(/^\s{0,3}\|/gm, ' ')             // 表格线
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, ' ')  // 分隔线
    .replace(/[*_~]{1,3}/g, '')               // 强调符号
    .replace(/\s+/g, ' ')
    .trim()
}

function pad(n) { return String(n).padStart(2, '0') }

/** 生成稳定的短标识（用于静态打包时的文件名、以及锚点） */
export function slugify(text, fallback = 'note') {
  const s = String(text)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#%&{}$!@+=`'\[\]();,~^]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return s || fallback
}

/**
 * 把文件夹名「洗干净」当作分类名：
 *   linux操作系统_md → linux操作系统      web前端设计与开发.md → web前端设计与开发
 * 配置里写了 display 就用配置里的。
 */
function cleanCourse(folder) {
  return String(folder)
    .replace(/[_\-\s]*m[dk]$/i, '')
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .trim() || folder
}

/** 「第 1—4 节」这类小节号，用于把同一门课的笔记按顺序排好 */
function sectionWeight(name) {
  const m = String(name).match(/(\d+)\s*[-—~至to]{1,2}\s*(\d+)/i) || String(name).match(/(\d+)/)
  return m ? Number(m[1]) * 1000 + Number(m[2] || 0) : 999999
}

/** 读取笔记文件夹并生成清单对象 */
export async function buildManifest() {
  const { notesDir } = config
  const files = await walk(notesDir)
  const notes = []
  const courseDisplay = config.courseDisplay || {}

  for (const file of files) {
    const rel = relative(notesDir, file).split(sep).join('/')
    const stat = await fs.stat(file)
    const raw = await fs.readFile(file, 'utf8')
    const segments = rel.split('/')
    const folder = segments.length > 1 ? segments[0] : '未分类'
    const course = courseDisplay[folder] || cleanCourse(folder)
    const fileName = segments[segments.length - 1].replace(/\.(md|markdown|mdown|mkd)$/i, '')
    const title = (config.noteTitles && config.noteTitles[rel]) || extractTitle(raw, file)
    const text = plainText(raw)

    notes.push({
      path: rel,
      folder,
      course,
      title,
      fileName,
      slug: slugify(fileName),
      size: stat.size,
      mtime: stat.mtimeMs,
      updated: `${stat.mtime.getFullYear()}-${pad(stat.mtime.getMonth() + 1)}-${pad(stat.mtime.getDate())} ${pad(stat.mtime.getHours())}:${pad(stat.mtime.getMinutes())}`,
      words: text.replace(/\s/g, '').length,
      excerpt: text.slice(0, 600),
      order: sectionWeight(fileName),
    })
  }

  // 排序：先按分类（可用 config.courseOrder 指定顺序），再按同一门课的小节号
  const courseOrder = config.courseOrder || []
  const courseRank = (c) => {
    const i = courseOrder.findIndex((x) => c.includes(x) || x.includes(c))
    return i === -1 ? 999 : i
  }
  notes.sort(
    (a, b) =>
      courseRank(a.course) - courseRank(b.course) ||
      a.course.localeCompare(b.course, 'zh-Hans-CN') ||
      a.order - b.order ||
      a.fileName.localeCompare(b.fileName, 'zh-Hans-CN', { numeric: true })
  )

  return { generatedAt: Date.now(), count: notes.length, notes }
}

/** 生成并写入清单文件 */
export async function writeManifest() {
  const manifest = await buildManifest()
  await fs.mkdir(join(config.manifestFile, '..'), { recursive: true })
  await fs.writeFile(config.manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

/** 读取已生成的清单（不存在时自动生成一份） */
export async function readManifest() {
  try {
    const raw = await fs.readFile(config.manifestFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return writeManifest()
  }
}
