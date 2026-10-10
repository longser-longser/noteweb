/**
 * 曲库扫描 —— 把 music/ 文件夹里的音频变成播放器能读的清单（data/music.json）。
 *
 * 设计目标：
 *   1. 零依赖（不装任何 npm 包，只用 Node 自带能力）；
 *   2. 加歌不用改代码 —— 把文件丢进 music/，重新 build 或启动服务器时会自动重扫；
 *   3. 只报告能确认的信息，不猜、不编：读不出来的字段就是 null，前端显示“—”；
 *   4. 浏览器放不了的格式也照样登记，标出限制，不静默丢掉、也不偷偷转码。
 *
 * 用法：
 *   node scripts/music-scan.mjs            有变化才重扫
 *   node scripts/music-scan.mjs --force    强制重扫
 */
import { promises as fs } from 'node:fs'
import { join, extname, sep, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { config } from '../config.mjs'

/* ------------------------------ 格式知识表 ------------------------------ */
/** 现代浏览器（Chrome/Edge/Firefox/Safari）一般能直接播的格式 */
export const NATIVE_EXT = new Set([
  '.flac', '.mp3', '.wav', '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.weba', '.webm',
])
/** 浏览器普遍不能直接播的格式（登记但标记限制，需要额外解码或转码才能听） */
export const NON_NATIVE_EXT = new Set(['.ape', '.wma', '.alac', '.dsf', '.dff', '.mpc', '.wv', '.tak', '.mka'])
/** 部分浏览器能播（例如 Safari 支持 aiff，Chrome 不支持） */
export const PARTIAL_EXT = new Set(['.aiff', '.aif'])
/** 无损容器（只说明容器本身是无损压缩，不代表上游一定是母带级音源） */
export const LOSSLESS_EXT = new Set(['.flac', '.wav', '.aiff', '.aif', '.alac', '.ape'])

const AUDIO_EXT = new Set([...NATIVE_EXT, ...NON_NATIVE_EXT, ...PARTIAL_EXT])
const PICTURE_MAX = 8 * 1024 * 1024 // 封面最大读 8MB，防止异常文件撑爆内存

const FORMAT_NAME = {
  '.flac': 'FLAC', '.mp3': 'MP3', '.wav': 'WAV', '.m4a': 'M4A', '.mp4': 'MP4',
  '.aac': 'AAC', '.ogg': 'OGG', '.oga': 'OGG', '.opus': 'Opus', '.weba': 'WebM Audio',
  '.webm': 'WebM', '.ape': 'APE', '.wma': 'WMA', '.alac': 'ALAC', '.aiff': 'AIFF',
  '.aif': 'AIFF', '.dsf': 'DSF', '.dff': 'DFF', '.mpc': 'Musepack', '.wv': 'WavPack',
  '.tak': 'TAK', '.mka': 'Matroska Audio',
}

/* ------------------------------ 小工具 ------------------------------ */
const safeInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

/** 文件名 → 猜测的标题（去掉扩展名、去掉洛雪那类 "歌曲-歌手-数字ID-音质档" 尾巴） */
function titleFromFilename(name) {
  let s = name.replace(/\.[^.]+$/, '')
  s = s.replace(/\s*-\s*\d{5,}(-\d{3,4})?$/, '') // 去掉 -6749207-2000 这种尾巴
  s = s.replace(/[_\uFF3F]+/g, ' ')
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s || name
}

/** 文件名尾部若形如 xxx-艺术家-ID-档位，把中间那截当艺术家（弱推断，只在没有标签时用） */
function artistFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '')
  const m = base.match(/^(.+?)\s*-\s*(.+?)\s*-\s*\d{5,}(?:-\d{3,4})?$/)
  if (!m) return null
  const artist = m[2].replace(/[_\uFF3F]+/g, ' ').trim()
  return artist && artist.length <= 60 ? artist : null
}

/** 从 Vorbis comment 块里取标签 */
function parseVorbisComments(body) {
  const tags = {}
  try {
    let p = 0
    const vendorLen = body.readUInt32LE(p); p += 4 + vendorLen
    const count = body.readUInt32LE(p); p += 4
    for (let i = 0; i < count && p + 4 <= body.length; i++) {
      const len = body.readUInt32LE(p); p += 4
      if (p + len > body.length) break
      const line = body.toString('utf8', p, p + len); p += len
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).toUpperCase()
      const val = line.slice(eq + 1).trim()
      if (val && tags[key] == null) tags[key] = val
    }
  } catch { /* 解析失败就当没有标签 */ }
  return tags
}

/** 读 FLAC：STREAMINFO（时长/采样率/位深）+ VORBIS_COMMENT（标签）+ PICTURE（封面） */
async function readFlac(fh) {
  const head = Buffer.alloc(4)
  await fh.read(head, 0, 4, 0)
  if (head.toString('latin1') !== 'fLaC') return null
  const out = { container: 'flac', tags: {}, picture: null }
  let pos = 4
  for (let guard = 0; guard < 64; guard++) {
    const hdr = Buffer.alloc(4)
    const r = await fh.read(hdr, 0, 4, pos)
    if (r.bytesRead < 4) break
    const last = (hdr[0] & 0x80) !== 0
    const type = hdr[0] & 0x7f
    const len = (hdr[1] << 16) | (hdr[2] << 8) | hdr[3]
    pos += 4
    if (type === 0 && len >= 34) {
      const b = Buffer.alloc(34)
      await fh.read(b, 0, 34, pos)
      const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4)
      const channels = ((b[12] >> 1) & 0x07) + 1
      const bits = (((b[12] & 0x01) << 4) | (b[13] >> 4)) + 1
      const total = (b[13] & 0x0f) * 2 ** 32 + b[14] * 2 ** 24 + b[15] * 2 ** 16 + b[16] * 2 ** 8 + b[17]
      out.sampleRate = sampleRate || null
      out.channels = channels || null
      out.bitsPerSample = bits || null
      out.totalSamples = total || null
      if (sampleRate && total) out.duration = total / sampleRate
    } else if (type === 4 && len > 0 && len < 4 * 1024 * 1024) {
      const body = Buffer.alloc(len)
      await fh.read(body, 0, len, pos)
      Object.assign(out.tags, parseVorbisComments(body))
    } else if (type === 6 && len > 8 && len < PICTURE_MAX) {
      const body = Buffer.alloc(len)
      await fh.read(body, 0, len, pos)
      try {
        const mimeLen = body.readUInt32BE(4)
        const mime = body.toString('latin1', 8, 8 + mimeLen)
        let p = 8 + mimeLen
        const descLen = body.readUInt32BE(p); p += 4 + descLen
        p += 16 // width/height/depth/colors
        const dataLen = body.readUInt32BE(p); p += 4
        if (dataLen > 0 && p + dataLen <= body.length) {
          out.picture = { mime: mime || 'image/jpeg', data: body.subarray(p, p + dataLen) }
        }
      } catch { /* 封面坏了就忽略 */ }
    }
    pos += len
    if (last) break
  }
  return out
}

/** 极简 ID3v2 解析（TIT2/TPE1/TALB/APIC），够用即可 */
function parseId3(buf) {
  const out = { tags: {}, picture: null }
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return out
  const ver = buf[3]
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  let p = 10
  const end = Math.min(10 + size, buf.length)
  const idLen = ver === 2 ? 3 : 4
  const headLen = ver === 2 ? 6 : 10
  while (p + headLen <= end) {
    const id = buf.toString('latin1', p, p + idLen)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    let frameSize
    if (ver === 2) frameSize = (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5]
    else if (ver === 4) frameSize = ((buf[p + 4] & 0x7f) << 21) | ((buf[p + 5] & 0x7f) << 14) | ((buf[p + 6] & 0x7f) << 7) | (buf[p + 7] & 0x7f)
    else frameSize = buf.readUInt32BE(p + 4)
    if (frameSize <= 0 || p + headLen + frameSize > end) break
    const body = buf.subarray(p + headLen, p + headLen + frameSize)
    const key = { TIT2: 'TITLE', TT2: 'TITLE', TPE1: 'ARTIST', TP1: 'ARTIST', TALB: 'ALBUM', TAL: 'ALBUM', TDRC: 'DATE', TYER: 'DATE' }[id]
    if (key && body.length > 1) {
      const enc = body[0]
      let text = ''
      try {
        if (enc === 0) text = body.toString('latin1', 1)
        else if (enc === 1) text = body.toString('utf16le', 1)
        else if (enc === 2) text = body.toString('utf16le', 1) // 少见，按 utf16 处理
        else text = body.toString('utf8', 1)
      } catch { text = '' }
      text = text.replace(/\u0000+$/, '').replace(/^\uFEFF/, '').trim()
      if (text && out.tags[key] == null) out.tags[key] = text
    }
    if ((id === 'APIC' || id === 'PIC') && body.length > 8 && !out.picture) {
      try {
        let q = 1
        if (id === 'APIC') {
          const mimeEnd = body.indexOf(0, q)
          const mime = body.toString('latin1', q, mimeEnd)
          q = mimeEnd + 1
          q += 1 // picture type
          const descEnd = body.indexOf(0, q)
          q = descEnd + 1
          if (/image\//.test(mime)) out.picture = { mime, data: body.subarray(q) }
        } else {
          const mime = body.toString('latin1', q, q + 3)
          q += 3 + 1 + 1
          const descEnd = body.indexOf(0, q)
          q = descEnd + 1
          out.picture = { mime: mime === 'PNG' ? 'image/png' : 'image/jpeg', data: body.subarray(q) }
        }
      } catch { /* 忽略 */ }
    }
    p += headLen + frameSize
  }
  return out
}

/**
 * MP3：ID3 标签 + 按 MPEG 帧头读码率/采样率/声道。
 *
 * 时长优先用 Xing/Info 头里的帧数算（VBR 也准，标注 container）；
 * 没有 Xing/Info 就按 CBR 估算（标注 estimate）。
 * 表必须三层齐全（Layer I/II/III）—— 只写前两层会把 Layer III 当成假同步，
 * 读出 32kHz/64kbps 这种离谱数值（这个 bug 真出现过）。
 */
async function readMp3(fh, size) {
  const headBuf = Buffer.alloc(Math.min(size, 512 * 1024))
  await fh.read(headBuf, 0, headBuf.length, 0)
  const id3 = parseId3(headBuf)
  let audioStart = 0
  if (headBuf.toString('latin1', 0, 3) === 'ID3') {
    audioStart = 10 + (((headBuf[6] & 0x7f) << 21) | ((headBuf[7] & 0x7f) << 14) | ((headBuf[8] & 0x7f) << 7) | (headBuf[9] & 0x7f))
    if (headBuf[5] & 0x10) audioStart += 10 // 有 footer
  }
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
  const BR = {
    // MPEG1
    1: {
      1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
      2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
      3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    },
    // MPEG2 / MPEG2.5
    2: {
      1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
      2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    },
  }
  const out = { container: 'mp3', tags: id3.tags, picture: id3.picture }
  for (let i = audioStart; i < headBuf.length - 4; i++) {
    if (headBuf[i] !== 0xff || (headBuf[i + 1] & 0xe0) !== 0xe0) continue
    const verBits = (headBuf[i + 1] >> 3) & 0x03
    const layerBits = (headBuf[i + 1] >> 1) & 0x03
    const brIdx = (headBuf[i + 2] >> 4) & 0x0f
    const srIdx = (headBuf[i + 2] >> 2) & 0x03
    const padding = (headBuf[i + 2] >> 1) & 0x01
    const channelMode = (headBuf[i + 3] >> 6) & 0x03
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue
    const version = verBits === 3 ? 1 : 2
    const layer = 4 - layerBits
    const bitrate = (BR[version]?.[layer] || [])[brIdx] * 1000
    const sampleRate = (RATES[verBits] || [])[srIdx]
    if (!bitrate || !sampleRate) continue
    // 帧长：Layer I 系数 12，Layer II 固定 144，Layer III 在 MPEG2/2.5 是 72
    const coef = layer === 1 ? 12 : layer === 2 || version === 1 ? 144 : 72
    const frameLen = Math.floor((coef * bitrate) / sampleRate) + (layer === 1 ? padding * 4 : padding)
    // 用「下一帧也像帧头」排掉假同步（到了缓冲区末尾就没法验，直接认）
    const next = i + frameLen
    if (next + 1 < headBuf.length && !(headBuf[next] === 0xff && (headBuf[next + 1] & 0xe0) === 0xe0)) continue
    out.bitrate = bitrate
    out.sampleRate = sampleRate
    out.channels = channelMode === 3 ? 1 : 2
    const samplesPerFrame = layer === 1 ? 384 : layer === 3 && version === 2 ? 576 : 1152
    // Xing/Info 头就在第一帧的边信息后面
    const sideLen = version === 1 ? (out.channels === 1 ? 17 : 32) : out.channels === 1 ? 9 : 17
    const xingAt = i + 4 + sideLen
    const xingTag = headBuf.toString('latin1', xingAt, xingAt + 4)
    if ((xingTag === 'Xing' || xingTag === 'Info') && xingAt + 12 <= headBuf.length) {
      const flags = headBuf.readUInt32BE(xingAt + 4)
      if (flags & 0x01) {
        const frames = headBuf.readUInt32BE(xingAt + 8)
        if (frames > 0) {
          out.duration = (frames * samplesPerFrame) / sampleRate
          out.durationEstimated = false
          return out
        }
      }
    }
    out.duration = ((size - audioStart) * 8) / bitrate
    out.durationEstimated = true
    return out
  }
  return out
}

/** WAV：fmt 块给字节率，data 块给长度 → 时长精确 */
async function readWav(fh, size) {
  const buf = Buffer.alloc(Math.min(size, 256 * 1024))
  await fh.read(buf, 0, buf.length, 0)
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null
  const out = { container: 'wav', tags: {} }
  let p = 12
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4)
    const len = buf.readUInt32LE(p + 4)
    if (id === 'fmt ' && len >= 16) {
      out.channels = buf.readUInt16LE(p + 10)
      out.sampleRate = buf.readUInt32LE(p + 12)
      out.bitrate = buf.readUInt32LE(p + 16)
      out.bitsPerSample = buf.readUInt16LE(p + 22)
    } else if (id === 'data' && out.bitrate) {
      out.duration = len / out.bitrate
      break
    }
    p += 8 + len + (len % 2)
    if (len <= 0) break
  }
  return out
}

/* ------------------------------ 主流程 ------------------------------ */
async function walk(dir, base = dir) {
  const out = []
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile()) out.push({ full, rel: full.slice(base.length + 1) })
  }
  return out
}

async function loadOverrides() {
  try {
    const raw = await fs.readFile(config.musicOverridesFile, 'utf8')
    const data = JSON.parse(raw)
    const map = new Map()
    for (const [key, val] of Object.entries(data)) {
      if (key.startsWith('_')) continue
      if (val && typeof val === 'object') map.set(key.toLowerCase(), val)
    }
    return map
  } catch {
    return new Map()
  }
}

/** 扫描曲库并写出 data/music.json */
export async function scanMusic({ quiet = false } = {}) {
  const files = (await walk(config.musicDir)).filter((f) => AUDIO_EXT.has(extname(f.rel).toLowerCase()))
  const overrides = await loadOverrides()
  const coversDir = join(config.musicWebDir, 'covers')
  const tracks = []
  const skipped = []

  for (const f of files) {
    const ext = extname(f.rel).toLowerCase()
    const stat = await fs.stat(f.full)
    const name = f.rel.split(sep).pop()
    const ov = overrides.get(f.rel.toLowerCase()) || overrides.get(name.toLowerCase()) || {}

    let meta = null
    let fh = null
    try {
      fh = await fs.open(f.full, 'r')
      if (ext === '.flac') meta = await readFlac(fh)
      else if (ext === '.mp3') meta = await readMp3(fh, stat.size)
      else if (ext === '.wav') meta = await readWav(fh, stat.size)
    } catch (err) {
      skipped.push({ file: f.rel, reason: '读取元数据失败：' + (err.message || err) })
    } finally {
      if (fh) await fh.close().catch(() => {})
    }

    const tags = (meta && meta.tags) || {}
    const title = (ov.title || tags.TITLE || titleFromFilename(name)).trim()
    const artist = ov.artist || tags.ARTIST || null
    const guessedArtist = !artist && !tags.ARTIST ? artistFromFilename(name) : null

    // 封面：导出到 web/music/covers/（只在需要时写，避免每次重扫都写盘）
    let cover = null
    if (meta && meta.picture && meta.picture.data && meta.picture.data.length > 0) {
      const hash = createHash('sha1').update(f.rel).digest('hex').slice(0, 8)
      const ext2 = /png/i.test(meta.picture.mime) ? 'png' : 'jpg'
      const outName = `${hash}.${ext2}`
      const outPath = join(coversDir, outName)
      await fs.mkdir(coversDir, { recursive: true })
      const exists = await fs.stat(outPath).then((s) => s.size === meta.picture.data.length).catch(() => false)
      if (!exists) await fs.writeFile(outPath, meta.picture.data)
      cover = `covers/${outName}`
    }
    if (ov.cover) cover = ov.cover

    const duration = Number.isFinite(meta?.duration) ? meta.duration : null
    const bitrate = meta?.bitrate || (duration ? (stat.size * 8) / duration : null)
    const native = NATIVE_EXT.has(ext)
    const partial = PARTIAL_EXT.has(ext)

    tracks.push({
      file: f.rel.split(sep).join('/'),
      title: title || name,
      artist,
      artistGuessed: guessedArtist,
      album: ov.album || tags.ALBUM || null,
      date: tags.DATE || null,
      trackNo: tags.TRACKNUMBER ? Number(tags.TRACKNUMBER) || null : null,
      ext,
      format: FORMAT_NAME[ext] || ext.replace('.', '').toUpperCase(),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      duration: duration ? Math.round(duration * 10) / 10 : null,
      durationSource: duration ? (meta.durationEstimated ? 'estimate' : 'container') : null,
      sampleRate: safeInt(meta?.sampleRate),
      bitsPerSample: safeInt(meta?.bitsPerSample),
      channels: safeInt(meta?.channels),
      bitrate: bitrate ? Math.round(bitrate) : null,
      lossless: LOSSLESS_EXT.has(ext) ? true : (NATIVE_EXT.has(ext) || NON_NATIVE_EXT.has(ext) ? false : null),
      losslessNote: LOSSLESS_EXT.has(ext)
        ? '无损压缩容器（不代表上游一定是母带级音源）'
        : '有损压缩格式',
      playable: native ? true : (partial ? 'partial' : false),
      limitation: native
        ? null
        : partial
          ? 'Chrome/Edge 通常不能直接播放，Safari 可以'
          : '浏览器一般不能直接播放，需要先转码或用外部播放器',
      cover,
      original: ov.original === true,
      lyrics: ov.lyrics || null,
      hasTags: Object.keys(tags).length > 0,
      tagSource: tags.TITLE || tags.ARTIST ? (ov.title || ov.artist ? 'tag+override' : 'tag') : (ov.title ? 'override' : 'filename'),
      note: ov.note || null,
    })
  }

  // 排序：先按覆盖文件里给的 order，再按标题
  tracks.sort((a, b) => {
    const oa = overrides.get(a.file.toLowerCase())?.order ?? overrides.get(a.file.split('/').pop().toLowerCase())?.order
    const ob = overrides.get(b.file.toLowerCase())?.order ?? overrides.get(b.file.split('/').pop().toLowerCase())?.order
    if (oa != null || ob != null) return (oa ?? 9999) - (ob ?? 9999)
    return a.file.localeCompare(b.file, 'zh-Hans-CN')
  })

  const totalBytes = tracks.reduce((s, t) => s + t.size, 0)
  const totalDuration = tracks.reduce((s, t) => s + (t.duration || 0), 0)
  const byFormat = {}
  for (const t of tracks) byFormat[t.format] = (byFormat[t.format] || 0) + 1

  const library = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: 'music',
    count: tracks.length,
    totalBytes,
    totalDuration: Math.round(totalDuration * 10) / 10,
    formats: byFormat,
    playableCount: tracks.filter((t) => t.playable === true).length,
    unplayableCount: tracks.filter((t) => t.playable === false).length,
    losslessCount: tracks.filter((t) => t.lossless === true).length,
    withCoverCount: tracks.filter((t) => !!t.cover).length,
    skipped,
    tracks,
  }

  await fs.mkdir(dirname(config.musicManifestFile), { recursive: true })
  await fs.writeFile(config.musicManifestFile, JSON.stringify(library, null, 2) + '\n', 'utf8')
  if (!quiet) {
    console.log(`   ♪ 曲库已扫描：${library.count} 首，${(totalBytes / 1024 / 1024).toFixed(1)} MB，可直接播放 ${library.playableCount} 首`)
    if (library.unplayableCount) console.log(`   ⚠ 有 ${library.unplayableCount} 首浏览器不能直接播放（已在清单里标明限制）`)
    for (const s of skipped) console.log(`   ⚠ 跳过读取：${s.file}（${s.reason}）`)
  }
  return library
}

/** 读清单；清单不存在或曲库有更新时自动重扫 */
export async function ensureMusicLibrary({ force = false } = {}) {
  if (!force) {
    try {
      const stat = await fs.stat(config.musicManifestFile)
      const data = JSON.parse(await fs.readFile(config.musicManifestFile, 'utf8'))
      const files = (await walk(config.musicDir)).filter((f) => AUDIO_EXT.has(extname(f.rel).toLowerCase()))
      let newest = 0
      for (const f of files) {
        const s = await fs.stat(f.full).catch(() => null)
        if (s && s.mtimeMs > newest) newest = s.mtimeMs
      }
      if (data.count === files.length && newest <= stat.mtimeMs) return data
    } catch { /* 落到下面重扫 */ }
  }
  return scanMusic()
}

/** 读清单（不扫盘），没有就返回空壳 */
export async function readMusicLibrary() {
  try {
    return JSON.parse(await fs.readFile(config.musicManifestFile, 'utf8'))
  } catch {
    return { version: 1, count: 0, totalBytes: 0, totalDuration: 0, formats: {}, tracks: [], skipped: [] }
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('music-scan.mjs')) {
  scanMusic({ quiet: false }).catch((err) => {
    console.error('✗ 曲库扫描失败：', err?.message || err)
    process.exit(1)
  })
}
