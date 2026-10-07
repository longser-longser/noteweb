/**
 * 把「已总结稿.md」里的笔记复制到 NoteWeb/notes/，并重建清单。
 *
 * 用法：  node scripts/sync-notes.mjs
 *
 * 为什么需要复制？因为要保证整个 NoteWeb 文件夹是自包含的：
 * 以后要打包上传到网上的时候，必须把所有笔记一起放进输出目录里。
 */
import { promises as fs } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { config } from '../config.mjs'
import { writeManifest } from './manifest.mjs'

/** 这些后缀会被当作笔记收进来 */
const NOTE_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd'])
/** 会被一起复制过去的资源后缀（图片、附件等） */
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.pdf', '.canvas'])

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/** 递归复制：笔记文件 + 图片等资源 */
async function copyTree(from, to, stats) {
  const entries = await fs.readdir(from, { withFileTypes: true })
  await fs.mkdir(to, { recursive: true })
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const src = join(from, e.name)
    const dst = join(to, e.name)
    if (e.isDirectory()) {
      await copyTree(src, dst, stats)
      continue
    }
    if (!e.isFile()) continue
    const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase()
    if (NOTE_EXT.has(ext)) {
      await fs.copyFile(src, dst)
      stats.notes++
    } else if (ASSET_EXT.has(ext)) {
      await fs.copyFile(src, dst)
      stats.assets++
    } else {
      stats.skipped++
    }
  }
}

async function main() {
  const { sourceDir, notesDir } = config
  if (!(await exists(sourceDir))) {
    console.error(`✗ 找不到笔记来源文件夹：${sourceDir}`)
    console.error('  请修改 config.mjs 里的 sourceDir 指向你的笔记文件夹。')
    process.exit(1)
  }

  console.log(`来源：${sourceDir}`)
  console.log(`目标：${notesDir}`)

  // 清空旧副本，避免删掉的笔记还留在网站上
  await fs.rm(notesDir, { recursive: true, force: true })

  const stats = { notes: 0, assets: 0, skipped: 0 }
  await copyTree(sourceDir, notesDir, stats)

  const manifest = await writeManifest()
  const courses = new Map()
  for (const n of manifest.notes) courses.set(n.course, (courses.get(n.course) || 0) + 1)

  console.log('')
  console.log(`✓ 已复制 ${stats.notes} 篇笔记、${stats.assets} 个资源文件` + (stats.skipped ? `（跳过 ${stats.skipped} 个非笔记文件）` : ''))
  console.log(`✓ 共 ${courses.size} 个分类：`)
  for (const [course, count] of courses) console.log(`    ${course}  —  ${count} 篇`)
  console.log('')
  console.log('目录相对位置：' + relative(process.cwd(), config.manifestFile))
}

main().catch((err) => {
  console.error('✗ 同步失败：', err?.message || err)
  process.exit(1)
})
