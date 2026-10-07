/**
 * 渲染自检 —— 跑一遍常见 Markdown 写法，确认都能正确显示。
 * 用法：node scripts/selftest.mjs        （改完 renderer.mjs 之后跑一下最踏实）
 */
import { renderMarkdown, extractHeadings } from './renderer.mjs'
import { extractTitle, plainText, slugify } from './manifest.mjs'

/** [说明, 输入, 必须包含的片段[], 必须不包含的片段[]] */
const cases = [
  ['中文句号结尾的加粗', '所以**"变量一"可以放心重新赋值了**。', ['<strong>&quot;变量一&quot;可以放心重新赋值了</strong>'], ['**']],
  ['中文分号结尾的加粗', '- 它是**"域"的基本管理单元**；', ['<strong>'], ['**']],
  ['全角括号结尾的加粗', '切换到**控制台（Console）**面板；', ['<strong>控制台（Console）</strong>'], ['**']],
  ['引号紧贴加粗内侧', '选**"稍后安装操作系统"**——先建一台空机器', ['<strong>'], ['**']],
  ['常规加粗斜体行内代码', '普通 **加粗** 和 *斜体* 和 `代码`。', ['<strong>加粗</strong>', '<em>斜体</em>', '<code>代码</code>'], ['**']],
  ['表格', '| A | B |\n|---|---|\n| 1 | 2 |', ['<table>', '<th>A</th>', '<td>2</td>'], []],
  ['引用', '> 第一行\n> 第二行', ['<blockquote>'], []],
  ['代码块', '```js\nvar a = 1 < 2 && "x";\n```', ['<code>', 'code-block'], []],
  ['行内代码里的星号保持原样', '`代码**里的**` 与 **真的加粗**', ['<code>代码**里的**</code>', '<strong>真的加粗</strong>'], []],
  ['链接与裸网址', '见 [官网](https://example.com) 或 www.baidu.com', ['<a href="https://example.com">官网</a>'], []],
  ['表情符号标题', '## 📌 一、 人工智能发展背景', ['<h2', '📌'], []],
  ['反引号里的 HTML 标签原样显示', '用 `<p>` 段落标记，注意 `<html>` 双标签', ['<code>&lt;p&gt;</code>', '<code>&lt;html&gt;</code>'], []],
  ['未加反引号的 HTML 会当真 HTML（高级用法）', '用 <p> 段落标记', ['<p>用 <p> 段落标记</p>'], []],
  ['单独的星号当乘号', '使用 * 号通配符，2 * 3 = 6', [], ['<strong>', '<em>']],
  ['孤立星号不报错也不乱改', '变量一**和"变量二"里了。', ['变量一'], []],
]

let fail = 0
for (const [name, src, mustHave, mustNot] of cases) {
  const html = renderMarkdown(src)
  const missing = mustHave.filter((s) => !html.includes(s))
  const extra = mustNot.filter((s) => html.includes(s))
  const ok = !missing.length && !extra.length
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) {
    if (missing.length) console.log(`     缺少：${missing.join(' / ')}`)
    if (extra.length) console.log(`     不该有：${extra.join(' / ')}`)
  }
  console.log(`     ${html.replace(/\n/g, ' ').slice(0, 150)}`)
}

console.log('\n--- 标题提取（要跳过代码块里的 # ） ---')
for (const [src, expect] of [
  ['# 真实标题\n\n正文', '真实标题'],
  ['# 标题\n\n```\n# Step 1: 不是标题\n```\n', '标题'],
  ['```\n# Step 1\n```\n', 'fallback'],
  ['没有标题的正文', 'fallback'],
  ['# 带 *强调* 的标题', '带 强调 的标题'],
]) {
  const got = extractTitle(src, 'fallback.md')
  const ok = got === expect
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} 期望「${expect}」得到「${got}」`)
}

console.log('\n--- 标题锚点与目录 ---')
const h = renderMarkdown('## 一、课程背景\n\n## 一、课程背景\n\n### 1.1 小标题')
const heads = extractHeadings(h)
const idsOk = heads.length === 3 && new Set(heads.map((x) => x.id)).size === 3
if (!idsOk) fail++
console.log(`${idsOk ? '✓' : '✗'} ${heads.map((x) => x.id).join(' | ')}`)

console.log('\n--- 摘要去语法 ---')
const plain = plainText('# 标题\n\n- **重点**：`code` 与 [链接](http://x.com)\n\n> 引用\n\n```\n忽略我\n```')
const plainOk = !plain.includes('**') && !plain.includes('```') && plain.includes('重点')
if (!plainOk) fail++
console.log(`${plainOk ? '✓' : '✗'} ${plain}`)

console.log('\n--- 文件名净化 ---')
const slug = slugify('网络操作系统_第1-4节_课堂笔记.md')
const slugOk = !/[:*?"<>|\\/]/.test(slug) && slug.length > 0
if (!slugOk) fail++
console.log(`${slugOk ? '✓' : '✗'} ${slug} | ${slugify('a/b\\c*d?e')}`)

console.log(`\n结果：${fail === 0 ? '全部通过 ✓' : fail + ' 项有问题 ✗'}`)
process.exit(fail === 0 ? 0 : 1)
