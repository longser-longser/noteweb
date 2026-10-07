/**
 * 站点配置文件 —— 想改标题、端口、笔记来源，只改这一个文件即可。
 *
 * 路径全部用「相对于本文件（NoteWeb 文件夹）」的相对路径，
 * 所以整个 NoteWeb 文件夹可以随意搬动，不需要改配置。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** NoteWeb 文件夹的绝对路径 */
export const ROOT = dirname(fileURLToPath(import.meta.url))

export const config = {
  /** 网站标题（显示在浏览器标签页和侧边栏顶部） */
  siteTitle: '课堂笔记',

  /** 网站副标题（显示在侧边栏标题下方，留空则隐藏） */
  siteTagline: '录音整理 · 22 篇',

  /** 笔记原始来源文件夹（自动同步脚本会把它读进来） */
  sourceDir: join(ROOT, '..', '已总结稿.md'),

  /** 网站实际读取的笔记文件夹（由同步脚本生成，不要手动改） */
  notesDir: join(ROOT, 'notes'),

  /** 网页文件所在文件夹 */
  webDir: join(ROOT, 'web'),

  /** 打包输出文件夹（静态部署用） */
  distDir: join(ROOT, 'dist'),

  /** 生成的清单文件（不用管） */
  manifestFile: join(ROOT, 'data', 'manifest.json'),

  /** 本地服务器端口。被占用时，加 --port=其它数字 换一个 */
  port: 5173,

  /** 监听地址。0.0.0.0 = 局域网内其他设备也能访问；127.0.0.1 = 只有本机能访问 */
  host: '0.0.0.0',

  /**
   * 分类（文件夹）显示名。
   * 左边的名字必须和「已总结稿.md」里的文件夹名一模一样，右边是你想显示的名字。
   * 没写在这里的文件夹，会自动去掉 _md / .md 这类后缀后显示。
   */
  courseDisplay: {
    'linux操作系统_md': 'Linux 操作系统',
    'ps_md': 'Photoshop 图像处理',
    'sqlserver_md': 'SQL Server 数据库',
    'web前端设计与开发.md': 'Web 前端设计与开发',
    '人工智能导论.md': '人工智能导论',
    '网络操作系统.md': '网络操作系统',
  },

  /** 侧边栏里分类的排列顺序（从上到下）。写个关键词就行，能对上即可 */
  courseOrder: ['Linux', 'Web', 'Photoshop', 'SQL', '网络操作系统', '人工智能'],

  /**
   * 想给某篇笔记换个更清楚的名字，在这里写。
   * 左边是「分类文件夹名/文件名」（含后缀），右边是显示的名字。
   * 不写的话，就自动用笔记正文里的第一个 # 标题。
   */
  noteTitles: {
    'web前端设计与开发.md/Web1to4.markdown': 'Web 1–4 节：HTML / CSS / JS 入门（课程录音总结）',
  },
}
