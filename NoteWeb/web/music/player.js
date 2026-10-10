/**
 * 全站音乐播放器 —— 首页、笔记页、音乐库页共用同一个脚本。
 *
 * 设计要点：
 *   · 零依赖，只用浏览器原生能力；全站只有一个 <audio> 实例，不会两首歌同时响；
 *   · 只按需加载：默认 preload="none"，点哪首才取哪首，不会一次性下载整个曲库；
 *   · 界面状态全部由 <audio> 的真实事件驱动，保证“看到的就是听到的”；
 *   · 跨页面连续播放：站点是多页静态站，页面一跳转 <audio> 必然销毁。
 *     所以这里提供两条路：
 *       1) 独立小窗（🎧 按钮）—— 播放发生在从不刷新的小窗里，翻笔记时真正不中断；
 *       2) 断点续播 —— 跳页时把“曲目 + 播放位置”记在 sessionStorage，新页面接着放。
 *          这条有 0.1~0.5 秒间隙，不是无缝，界面上也如实这么写。
 */
(function () {
  'use strict'
  if (window.__NOTEWEB_MUSIC__) return

  var script = document.currentScript
  var BASE = (script && script.dataset.musicBase) || './music/'
  if (!/\/$/.test(BASE)) BASE += '/'
  var params = new URLSearchParams(location.search)
  var IS_MINI = params.get('mini') === '1'
  // 站点根地址（独立小窗要打开的是首页 + 播放条，不是当前这篇笔记）
  var ROOT_URL = new URL((script && script.dataset.siteBase) || './', location.href).href
  var STATE_KEY = 'noteweb-music-state'
  var VOL_KEY = 'noteweb-music-vol'
  var MUTE_KEY = 'noteweb-music-mute'
  var OWNER_KEY = 'noteweb-music-owner'
  var MY_ID = 'p' + Math.random().toString(36).slice(2, 10)
  var OWNER_TTL = 7000
  // 免责声明：全站只此一份文案，曲库列表页脚、播放条悬停提示都用它
  var COPYRIGHT = '音乐版权归原作者及发行方所有，本站仅为个人学习整理，仅供个人试听，请勿转载传播。'

  /* ---------------------------- 小工具 ---------------------------- */
  function encodePath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/')
  }
  function trackUrl(t) { return BASE + encodePath(t.file) }
  function coverUrl(t) { return t && t.cover ? BASE + encodePath(t.cover) : BASE + 'default-cover.svg' }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00'
    sec = Math.floor(sec)
    var h = Math.floor(sec / 3600)
    var m = Math.floor((sec % 3600) / 60)
    var s = sec % 60
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0')
  }
  function fmtSize(bytes) {
    if (!bytes) return '—'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  }
  function h(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val) } catch (e) {} }
  function sstore(key, val) { try { if (val === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key, val) } catch (e) {} }

  /* ---------------------------- 图标 ----------------------------
   * 统一的内联 SVG 线性图标（24×24、stroke 跟随文字颜色），
   * 不引第三方图标库、不下载图片：深浅色、两种缩放都清晰，也不会像 emoji 那样各系统长得不一样。
   */
  var ICONS = {
    play: '<path d="M8.6 5.6v12.8L19 12z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7.2" y="5.4" width="3.4" height="13.2" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.4" y="5.4" width="3.4" height="13.2" rx="1.2" fill="currentColor" stroke="none"/>',
    prev: '<rect x="5" y="5.8" width="2.4" height="12.4" rx="1.1" fill="currentColor" stroke="none"/><path d="M19 6.6v10.8L9.8 12z" fill="currentColor" stroke="none"/>',
    next: '<rect x="16.6" y="5.8" width="2.4" height="12.4" rx="1.1" fill="currentColor" stroke="none"/><path d="M5 6.6v10.8L14.2 12z" fill="currentColor" stroke="none"/>',
    shuffle: '<path d="M16.4 3.8h3.8v3.8"/><path d="M20.2 3.8 12.8 11.2"/><path d="M16.4 20.2h3.8v-3.8"/><path d="M13.2 13.2l7 7"/><path d="M3.8 3.8l5 5"/><path d="M3.8 20.2 12.4 11.6"/>',
    repeat: '<path d="M7.6 3.8h8.8a3 3 0 0 1 3 3v1.4"/><path d="M17.2 3.4l2.8 2.8-2.8 2.8"/><path d="M16.4 20.2H7.6a3 3 0 0 1-3-3v-1.4"/><path d="M6.8 20.6 4 17.8l2.8-2.8"/>',
    'repeat-one': '<path d="M7.6 3.8h8.8a3 3 0 0 1 3 3v1.4"/><path d="M17.2 3.4l2.8 2.8-2.8 2.8"/><path d="M16.4 20.2H7.6a3 3 0 0 1-3-3v-1.4"/><path d="M6.8 20.6 4 17.8l2.8-2.8"/><path d="M12.3 10.6l1.7-1.2v5.6" stroke-linecap="round"/>',
    volume: '<path d="M4.4 9.6h2.8L11 6.4v11.2L7.2 14.4H4.4z" fill="currentColor" stroke="none"/><path d="M14.6 9.6a3.6 3.6 0 0 1 0 4.8"/><path d="M17.2 7.2a7 7 0 0 1 0 9.6"/>',
    mute: '<path d="M4.4 9.6h2.8L11 6.4v11.2L7.2 14.4H4.4z" fill="currentColor" stroke="none"/><path d="M15.2 10.2l4.4 4.4M19.6 10.2l-4.4 4.4"/>',
    headphones: '<path d="M4.6 14.6v-2.2a7.4 7.4 0 0 1 14.8 0v2.2"/><rect x="3" y="13.2" width="4.2" height="6.8" rx="1.6"/><rect x="16.8" y="13.2" width="4.2" height="6.8" rx="1.6"/>',
    list: '<path d="M4 6.4h16M4 12h16M4 17.6h9.6"/>',
    note: '<path d="M9.6 17.2V6.6l8.2-1.8v10.4"/><ellipse cx="6.8" cy="17.6" rx="2.8" ry="2.2" fill="currentColor" stroke="none"/><ellipse cx="15" cy="15.8" rx="2.8" ry="2.2" fill="currentColor" stroke="none"/>',
    close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6"/><path d="M15.3 15.3 20 20"/>',
    warn: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.8v5.2M12 16.1v.3"/>',
  }
  var SVG_NS = 'http://www.w3.org/2000/svg'
  function icon(name, cls) {
    var s = document.createElementNS(SVG_NS, 'svg')
    s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('fill', 'none')
    s.setAttribute('stroke', 'currentColor')
    s.setAttribute('stroke-width', '1.7')
    s.setAttribute('stroke-linecap', 'round')
    s.setAttribute('stroke-linejoin', 'round')
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('focusable', 'false')
    s.setAttribute('class', 'nw-icon' + (cls ? ' ' + cls : ''))
    s.innerHTML = ICONS[name] || ''
    return s
  }
  /** 把按钮内容换成图标，同时保留可访问名称 */
  function setIcon(el, name) {
    if (!el) return
    var old = el.querySelector('svg')
    var next = icon(name)
    if (old) el.replaceChild(next, old)
    else { el.textContent = ''; el.appendChild(next) }
  }
  /** 带图标 + 文字的按钮内容 */
  function iconText(el, name, text) {
    el.textContent = ''
    el.appendChild(icon(name))
    el.appendChild(document.createTextNode(text))
  }

  /* ---------------------------- 状态 ---------------------------- */
  var lib = null
  var queue = []        // 曲目在 lib.tracks 里的下标，按当前播放顺序
  var cur = -1          // queue 里的位置
  var shuffle = false
  var repeat = 'off'    // off | all | one
  var dragging = false
  var resumeHint = false
  var pendingTime = 0
  var failed = {}
  var views = []        // 每个列表视图（整页 / 面板）各存一份行引用，避免互相覆盖

  // 全站唯一的 <audio>：preload=none，点哪首才取哪首。
  // 放进 DOM 只是为了让"页面上到底有几个音频实例"看得见、查得到（CSS 里 display:none）。
  var audio = document.createElement('audio')
  audio.preload = 'none'
  audio.id = 'nw-audio'
  audio.setAttribute('aria-hidden', 'true')
  audio.volume = Number(store(VOL_KEY) || 0.8)
  audio.muted = store(MUTE_KEY) === '1'

  function track() { return cur >= 0 ? lib.tracks[queue[cur]] : null }

  /* ---------------------------- 小窗与主页面谁在播 ---------------------------- */
  function readOwner() {
    try {
      var raw = localStorage.getItem(OWNER_KEY)
      if (!raw) return null
      var o = JSON.parse(raw)
      if (!o || !o.ts || Date.now() - o.ts > OWNER_TTL) return null
      return o
    } catch (e) { return null }
  }
  function claimOwnership(playing) {
    var t = track()
    try {
      localStorage.setItem(OWNER_KEY, JSON.stringify({
        id: MY_ID, ts: Date.now(), mini: IS_MINI,
        file: t ? t.file : null, title: t ? t.title : null,
        artist: t ? (t.artist || t.artistGuessed) : null,
        playing: !!playing, time: audio.currentTime || 0,
      }))
    } catch (e) {}
  }
  function releaseOwnership() {
    var o = readOwner()
    if (o && o.id === MY_ID) { try { localStorage.removeItem(OWNER_KEY) } catch (e) {} }
  }
  /** 别的窗口（小窗播放器）正在放吗？ */
  function otherOwner() {
    var o = readOwner()
    return o && o.id !== MY_ID ? o : null
  }

  /* ---------------------------- 界面 ---------------------------- */
  var ui = {}

  function buildMiniBar() {
    var bar = h('div', 'nw-bar')
    bar.id = 'nw-bar'

    var cover = h('img', 'nw-cover')
    cover.alt = ''
    cover.src = BASE + 'default-cover.svg'

    var info = h('div', 'nw-info')
    var title = h('div', 'nw-title', '音乐库')
    var sub = h('div', 'nw-sub', '正在载入曲库…')
    // 免责声明：悬停在歌名上就能看到，深浅色下都不会挤版面
    title.title = COPYRIGHT
    sub.title = COPYRIGHT
    info.appendChild(title)
    info.appendChild(sub)

    var btnLib = h('a', 'nw-btn nw-lib-btn')
    btnLib.href = BASE
    btnLib.title = '打开音乐库页面'
    btnLib.setAttribute('aria-label', '打开音乐库页面')
    btnLib.appendChild(icon('note'))

    var btnPanel = h('button', 'nw-btn nw-panel-btn')
    btnPanel.type = 'button'
    btnPanel.title = '展开曲库面板（不会中断播放）'
    btnPanel.setAttribute('aria-label', '展开曲库面板')
    btnPanel.setAttribute('aria-expanded', 'false')
    btnPanel.setAttribute('aria-controls', 'nw-panel')
    btnPanel.appendChild(icon('list'))

    var btnPrev = h('button', 'nw-btn')
    btnPrev.type = 'button'; btnPrev.title = '上一首'; btnPrev.setAttribute('aria-label', '上一首')
    btnPrev.appendChild(icon('prev'))

    var btnPlay = h('button', 'nw-btn nw-play')
    btnPlay.type = 'button'; btnPlay.title = '播放'; btnPlay.setAttribute('aria-label', '播放')
    btnPlay.disabled = true
    btnPlay.appendChild(icon('play'))

    var btnNext = h('button', 'nw-btn')
    btnNext.type = 'button'; btnNext.title = '下一首'; btnNext.setAttribute('aria-label', '下一首')
    btnNext.appendChild(icon('next'))

    var seekWrap = h('div', 'nw-seek')
    var seek = h('input', 'nw-range nw-seek-range')
    seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.step = '1'
    seek.setAttribute('aria-label', '播放进度')
    var times = h('div', 'nw-times')
    var tCur = h('span', 'nw-time-cur', '0:00')
    var tAll = h('span', 'nw-time-total', '0:00')
    times.appendChild(tCur); times.appendChild(h('span', 'nw-sep', '/')); times.appendChild(tAll)
    seekWrap.appendChild(seek); seekWrap.appendChild(times)

    var right = h('div', 'nw-right')
    var btnShuffle = h('button', 'nw-btn')
    btnShuffle.type = 'button'
    btnShuffle.title = '随机播放：关'
    btnShuffle.setAttribute('aria-label', '随机播放')
    btnShuffle.setAttribute('aria-pressed', 'false')
    btnShuffle.appendChild(icon('shuffle'))
    var btnRepeat = h('button', 'nw-btn')
    btnRepeat.type = 'button'
    btnRepeat.title = '循环模式：不循环'
    btnRepeat.setAttribute('aria-label', '循环模式：不循环')
    btnRepeat.setAttribute('aria-pressed', 'false')
    btnRepeat.appendChild(icon('repeat'))
    var volWrap = h('div', 'nw-vol')
    var btnMute = h('button', 'nw-btn')
    btnMute.type = 'button'; btnMute.title = '静音'; btnMute.setAttribute('aria-label', '静音')
    btnMute.setAttribute('aria-pressed', 'false')
    btnMute.appendChild(icon('volume'))
    var vol = h('input', 'nw-range nw-vol-range')
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.value = String(Math.round(audio.volume * 100))
    vol.setAttribute('aria-label', '音量')
    volWrap.appendChild(btnMute); volWrap.appendChild(vol)
    var btnMini = h('button', 'nw-btn nw-mini-btn')
    btnMini.type = 'button'
    btnMini.title = '在独立小窗里播放（翻页也不会中断）'
    btnMini.setAttribute('aria-label', '在独立小窗里播放')
    btnMini.appendChild(icon('headphones'))
    var status = h('div', 'nw-status', '')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')

    right.appendChild(btnShuffle); right.appendChild(btnRepeat); right.appendChild(volWrap)
    if (!IS_MINI) { right.appendChild(btnMini); right.appendChild(btnPanel); right.appendChild(btnLib) }

    bar.appendChild(cover)
    bar.appendChild(info)
    bar.appendChild(btnPrev)
    bar.appendChild(btnPlay)
    bar.appendChild(btnNext)
    bar.appendChild(seekWrap)
    bar.appendChild(right)
    bar.appendChild(status)

    document.body.appendChild(audio)
    document.body.appendChild(bar)
    document.body.classList.add(IS_MINI ? 'nw-mini' : 'nw-has-player')
    syncBarHeight()
    window.addEventListener('resize', syncBarHeight)

    ui.bar = bar; ui.cover = cover; ui.title = title; ui.sub = sub
    ui.play = btnPlay; ui.prev = btnPrev; ui.next = btnNext
    ui.seek = seek; ui.tCur = tCur; ui.tAll = tAll; ui.status = status
    ui.shuffle = btnShuffle; ui.repeat = btnRepeat; ui.vol = vol; ui.mute = btnMute; ui.volWrap = volWrap
    ui.panel = btnPanel; ui.miniBtn = btnMini; ui.libBtn = btnLib

    /* 事件绑定 */
    btnPlay.addEventListener('click', onPlayClick)
    btnPrev.addEventListener('click', function () { prev(false) })
    btnNext.addEventListener('click', function () { next(false) })
    seek.addEventListener('input', function () {
      dragging = true
      var d = audio.duration
      if (isFinite(d) && d > 0) tCur.textContent = fmtTime((Number(seek.value) / 1000) * d)
    })
    seek.addEventListener('change', function () {
      var d = audio.duration
      if (isFinite(d) && d > 0) audio.currentTime = (Number(seek.value) / 1000) * d
      dragging = false
    })
    vol.addEventListener('input', function () {
      audio.volume = Number(vol.value) / 100
      audio.muted = audio.volume === 0
      store(VOL_KEY, String(audio.volume)); store(MUTE_KEY, audio.muted ? '1' : '0')
      syncVolume()
    })
    btnMute.addEventListener('click', function () {
      audio.muted = !audio.muted
      store(MUTE_KEY, audio.muted ? '1' : '0')
      syncVolume()
    })
    btnShuffle.addEventListener('click', function () {
      shuffle = !shuffle
      if (shuffle && repeat === 'one') repeat = 'off'
      syncModes(); persist()
    })
    btnRepeat.addEventListener('click', function () {
      repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'
      syncModes(); persist()
    })
    btnPanel.addEventListener('click', function () { togglePanel() })
    btnMini.addEventListener('click', openMiniWindow)
    window.addEventListener('pagehide', function () { persist(true); if (IS_MINI) releaseOwnership() })
    window.addEventListener('beforeunload', function () { persist(true) })
    window.addEventListener('storage', function (e) {
      if (e.key === OWNER_KEY) syncOwnerBanner()
    })
  }

  /** 播放条实际高度写进 CSS 变量，正文/侧栏/回到顶部按钮的避让距离才准（手机换行后变高也跟得上） */
  function syncBarHeight() {
    if (!ui.bar) return
    var hgt = Math.round(ui.bar.getBoundingClientRect().height)
    if (hgt > 0) document.documentElement.style.setProperty('--nw-bar-h', hgt + 'px')
  }

  function syncVolume() {
    var silent = audio.muted || audio.volume === 0
    ui.vol.value = String(Math.round((silent ? 0 : audio.volume) * 100))
    setIcon(ui.mute, silent ? 'mute' : 'volume')
    ui.mute.title = silent ? '取消静音' : '静音'
    ui.mute.setAttribute('aria-label', silent ? '取消静音' : '静音')
    ui.mute.setAttribute('aria-pressed', silent ? 'true' : 'false')
    if (ui.volWrap) ui.volWrap.classList.toggle('is-muted', silent)
    ui.vol.setAttribute('aria-valuetext', Math.round((silent ? 0 : audio.volume) * 100) + '%')
  }

  function syncModes() {
    ui.shuffle.classList.toggle('is-on', shuffle)
    ui.shuffle.title = shuffle ? '随机播放：开' : '随机播放：关'
    ui.shuffle.setAttribute('aria-pressed', shuffle ? 'true' : 'false')
    ui.shuffle.setAttribute('aria-label', shuffle ? '随机播放（已开启）' : '随机播放（已关闭）')
    var label = repeat === 'off' ? '不循环' : repeat === 'all' ? '列表循环' : '单曲循环'
    setIcon(ui.repeat, repeat === 'one' ? 'repeat-one' : 'repeat')
    ui.repeat.classList.toggle('is-on', repeat !== 'off')
    ui.repeat.title = '循环模式：' + label
    ui.repeat.setAttribute('aria-pressed', repeat !== 'off' ? 'true' : 'false')
    ui.repeat.setAttribute('aria-label', '循环模式：' + label)
    if (ui.repeatLabel) {
      iconText(ui.repeatLabel, repeat === 'one' ? 'repeat-one' : 'repeat', label)
      ui.repeatLabel.classList.toggle('is-on', repeat !== 'off')
      ui.repeatLabel.title = '循环模式：' + label
      ui.repeatLabel.setAttribute('aria-label', '循环模式：' + label + '（点击切换）')
    }
  }

  function setStatus(text, kind) {
    ui.status.textContent = text || ''
    ui.status.className = 'nw-status' + (kind ? ' nw-status-' + kind : '')
    if (ui.pageStatus) { ui.pageStatus.textContent = text || ''; ui.pageStatus.className = 'nw-page-status' + (kind ? ' nw-page-status-' + kind : '') }
  }

  /* ---------------------------- 播放核心 ---------------------------- */
  /* 统一的失败文案：浏览器直接放不出来的，就说清楚为什么，不静默跳过 */
  function failText(t, fallbackName) {
    var name = t ? t.title : (fallbackName || '这首')
    return '播放失败：' + name + (t && t.limitation ? '（' + t.limitation + '）' : '（文件可能损坏或浏览器不支持）')
  }

  function loadTrack(pos, opts) {
    opts = opts || {}
    if (pos < 0 || pos >= queue.length) return
    cur = pos
    var t = track()
    if (!t) return
    failed = failed || {}
    // 浏览器根本放不了的格式（如 .ape/.wma）：不把地址塞给 <audio>，省掉一次注定失败的下载，
    // 但仍然选中这一首、写清限制，界面上照旧看得见、点得着。
    var cannotPlay = t.playable === false
    if (!cannotPlay) {
      audio.src = trackUrl(t)
      audio.load()
    } else {
      failed[t.file] = true
      audio.removeAttribute('src')
      audio.load()
    }
    ui.cover.src = coverUrl(t)
    ui.title.textContent = t.title
    var artist = t.artist || t.artistGuessed
    ui.sub.textContent = [artist || '未知艺术家', t.album, t.format].filter(Boolean).join(' · ')
    ui.tAll.textContent = t.duration ? fmtTime(t.duration) : '0:00'
    ui.seek.value = '0'
    ui.tCur.textContent = '0:00'
    ui.play.disabled = false
    highlightRows()
    updateMediaSession(t)
    setStatus(cannotPlay ? failText(t) : '加载中…', cannotPlay ? 'error' : 'loading')
    // 续播位置要等元数据就绪再设，提前设 currentTime 有些浏览器会直接忽略
    pendingTime = opts.time || 0
    if (opts.autoplay !== false && !cannotPlay) play()
    persist()
  }

  function play() {
    var t = track()
    if (!t) return
    if (t.playable === false) {
      setStatus(failText(t), 'error')
      highlightRows()
      return
    }
    // 同一个站点只允许一个地方出声：本页一开始播，就把播放权抢过来，
    // 另一个窗口（独立小窗或旧标签页）会在 2.5 秒内自动暂停。
    if (otherOwner()) claimOwnership(true)
    var p = audio.play()
    if (p && p.catch) {
      p.catch(function (err) {
        // 只有 NotAllowedError 才是"浏览器拦了自动播放、需要用户先点一下"；
        // 其它失败（文件没了、格式不支持）交给下面播不出来那条路，别报成"要求先点一下"。
        if (err && err.name && err.name !== 'NotAllowedError') return
        resumeHint = true
        setStatus('已暂停（浏览器要求先点一下）', 'paused')
        showResumeHint()
      })
    }
  }

  function pause() { audio.pause() }

  function onPlayClick() {
    if (audio.paused) play(); else pause()
  }

  function playAt(pos) { loadTrack(pos, { autoplay: true }) }

  function next(auto) {
    if (!queue.length) return
    if (auto && repeat === 'one') { audio.currentTime = 0; play(); return }
    var pos
    if (shuffle && queue.length > 1) {
      do { pos = Math.floor(Math.random() * queue.length) } while (pos === cur)
    } else {
      pos = cur + 1
      if (pos >= queue.length) {
        if (repeat === 'all') pos = 0
        else { setStatus('播放结束', 'ended'); audio.pause(); return }
      }
    }
    loadTrack(pos, { autoplay: true })
  }

  function prev() {
    if (!queue.length) return
    if (audio.currentTime > 3) { audio.currentTime = 0; return }
    var pos = cur - 1
    if (pos < 0) pos = repeat === 'all' ? queue.length - 1 : 0
    loadTrack(pos, { autoplay: true })
  }

  function persist(force) {
    var t = track()
    if (!t) return
    var now = Date.now()
    if (!force && persist.last && now - persist.last < 1500) return
    persist.last = now
    sstore(STATE_KEY, JSON.stringify({
      file: t.file, time: audio.currentTime || 0, playing: !audio.paused,
      shuffle: shuffle, repeat: repeat, ts: now,
    }))
    if (IS_MINI || audioOwnedByMe()) heartbeat()
  }
  function audioOwnedByMe() {
    var o = readOwner()
    return !o || o.id === MY_ID
  }
  function heartbeat() {
    if (audio.paused && !IS_MINI) return
    claimOwnership(!audio.paused)
  }

  /** 恢复上次听到的地方（断点续播，不是无缝） */
  function restore() {
    var raw = sstore(STATE_KEY)
    if (!raw) return false
    var s
    try { s = JSON.parse(raw) } catch (e) { return false }
    if (!s || !s.file) return false
    var pos = queue.findIndex(function (i) { return lib.tracks[i].file === s.file })
    if (pos < 0) return false
    shuffle = !!s.shuffle
    repeat = s.repeat || 'off'
    syncModes()
    var wantTime = Number(s.time) || 0
    var wantPlay = !!s.playing
    loadTrack(pos, { autoplay: false, time: wantTime })
    if (wantPlay) {
      // 页面刚加载就自动放会被浏览器拦，先试一次，失败就给“继续播放”提示
      var onReady = function () {
        audio.removeEventListener('canplay', onReady)
        play()
      }
      audio.addEventListener('canplay', onReady)
      setStatus('准备续播…', 'loading')
    } else {
      setStatus('已暂停', 'paused')
    }
    return true
  }

  function showResumeHint() {
    if (ui.resume) { ui.resume.hidden = false; return }
    var btn = h('button', 'nw-resume')
    btn.type = 'button'
    iconText(btn, 'play', '继续播放')
    btn.addEventListener('click', function () {
      btn.hidden = true
      resumeHint = false
      play()
    })
    ui.bar.insertBefore(btn, ui.bar.firstChild)
    ui.resume = btn
  }

  /* ---------------------------- 音频事件 → 界面 ---------------------------- */
  function bindAudio() {
    audio.addEventListener('loadedmetadata', function () {
      if (pendingTime > 0) {
        try { audio.currentTime = pendingTime } catch (e) {}
        pendingTime = 0
      }
    })
    audio.addEventListener('loadstart', function () { setStatus('加载中…', 'loading'); ui.bar.classList.add('is-loading') })
    audio.addEventListener('waiting', function () { setStatus('缓冲中…', 'loading'); ui.bar.classList.add('is-loading') })
    audio.addEventListener('canplay', function () { ui.bar.classList.remove('is-loading'); if (!audio.paused) setStatus('播放中', 'playing') })
    audio.addEventListener('playing', function () {
      ui.bar.classList.remove('is-loading')
      setIcon(ui.play, 'pause')
      ui.play.title = '暂停'
      ui.play.setAttribute('aria-label', '暂停')
      setStatus('播放中', 'playing')
      if (ui.resume) ui.resume.hidden = true
      hideOwnerBannerIfMine()
      highlightRows()
      persist(true)
    })
    audio.addEventListener('pause', function () {
      setIcon(ui.play, 'play')
      ui.play.title = '播放'
      ui.play.setAttribute('aria-label', '播放')
      var cur = track()
      // 放不出来的那一首别被"已暂停"盖掉失败提示
      if (!audio.ended && !resumeHint && !(cur && failed && failed[cur.file])) setStatus('已暂停', 'paused')
      highlightRows()
      persist(true)
    })
    audio.addEventListener('ended', function () {
      setIcon(ui.play, 'play')
      ui.play.setAttribute('aria-label', '播放')
      highlightRows()
      next(true)
    })
    audio.addEventListener('timeupdate', function () {
      var d = audio.duration
      if (!dragging && isFinite(d) && d > 0) {
        ui.seek.value = String(Math.round((audio.currentTime / d) * 1000))
        ui.tCur.textContent = fmtTime(audio.currentTime)
        ui.seek.setAttribute('aria-valuetext', fmtTime(audio.currentTime) + ' / ' + fmtTime(d))
      }
      persist(false)
    })
    audio.addEventListener('durationchange', function () {
      var d = audio.duration
      if (isFinite(d) && d > 0) {
        ui.tAll.textContent = fmtTime(d)
        var t = track()
        if (t && !t.duration) { t.duration = Math.round(d * 10) / 10; highlightRows() }
      }
    })
    audio.addEventListener('volumechange', syncVolume)
    audio.addEventListener('error', function () {
      var t = track()
      var name = t ? t.title : '这首'
      if (t) failed[t.file] = true
      ui.bar.classList.remove('is-loading')
      setIcon(ui.play, 'play')
      ui.play.title = '播放'
      ui.play.setAttribute('aria-label', '播放')
      setStatus('播放失败：' + name + (t && t.limitation ? '（' + t.limitation + '）' : '（文件可能损坏或浏览器不支持）'), 'error')
      highlightRows()
    })
  }

  /* ---------------------------- 曲库列表 ---------------------------- */
  function makeRow(t, pos) {
    var row = h('div', 'nw-row')
    row.dataset.file = t.file
    row.dataset.index = String(pos + 1)
    // 序号按钮：默认显示序号，鼠标悬停/当前曲目时变成播放或暂停图标
    var idx = h('button', 'nw-row-play')
    idx.type = 'button'
    idx.title = '播放这首'
    idx.setAttribute('aria-label', '播放 ' + t.title + (t.artist ? ' — ' + t.artist : ''))
    var num = h('span', 'nw-row-num', String(pos + 1))
    var ico = h('span', 'nw-row-icon')
    ico.appendChild(icon('play'))
    idx.appendChild(num); idx.appendChild(ico)
    var img = h('img', 'nw-row-cover')
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = coverUrl(t)
    var main = h('div', 'nw-row-main')
    var l1 = h('div', 'nw-row-title', t.title)
    l1.title = t.title
    var l2 = h('div', 'nw-row-sub')
    // 艺术家的来源要说清楚：内嵌标签里读到的直接用，从文件名猜的加虚线下划线
    var artistEl = h('span', t.artist ? null : 'nw-guess', t.artist || t.artistGuessed || '未知艺术家')
    if (!t.artist && t.artistGuessed) artistEl.title = '艺术家是从文件名推测的，可在 music.overrides.json 里改正'
    l2.appendChild(artistEl)
    var rest = [t.album, t.format].filter(Boolean).join(' · ')
    if (rest) l2.appendChild(document.createTextNode(' · ' + rest))
    main.appendChild(l1); main.appendChild(l2)
    var badges = h('div', 'nw-row-badges')
    badges.appendChild(badge(t.format, 'fmt'))
    if (t.lossless === true) badges.appendChild(badge('无损容器', 'lossless'))
    if (t.lossless === false) badges.appendChild(badge('有损', 'lossy'))
    if (t.original) badges.appendChild(badge('原创', 'original'))
    if (t.playable !== true) {
      var wb = badge('浏览器不能直接播放', 'warn')
      wb.title = t.limitation || '需要先转码成浏览器支持的格式'
      badges.appendChild(wb)
    }
    if (t.bitsPerSample && t.sampleRate) {
      var tb = badge((t.sampleRate / 1000) + 'kHz/' + t.bitsPerSample + 'bit', 'tech')
      tb.title = [t.sampleRate + ' Hz', t.bitsPerSample + ' bit', t.channels ? t.channels + ' 声道' : '', t.bitrate ? Math.round(t.bitrate / 1000) + ' kbps' : ''].filter(Boolean).join(' · ')
      badges.appendChild(tb)
    }
    var meta = h('div', 'nw-row-meta', [t.duration ? fmtTime(t.duration) : '时长未知', fmtSize(t.size)].join(' · '))
    var state = h('div', 'nw-row-state', '')
    row.appendChild(idx); row.appendChild(img); row.appendChild(main)
    row.appendChild(badges); row.appendChild(meta); row.appendChild(state)
    row.addEventListener('click', function (e) {
      if (e.target.closest('button') && e.target.closest('button') !== idx) return
      playAt(pos)
    })
    if (t.limitation) row.title = t.limitation
    return row
  }

  function badge(text, kind) { return h('span', 'nw-badge nw-badge-' + kind, text) }

  function renderLibrary(container, opts) {
    opts = opts || {}
    container.textContent = ''
    // 紧凑模式（♪ 面板）：去掉技术规格徽章、行内边距收紧，避免窄面板里徽章换行
    container.classList.toggle('nw-compact', !!opts.compact)
    var myRows = {}
    // 同一个容器重复渲染时复用视图，避免 highlightRows 里的引用失效
    var view = container.__nwView
    if (view) { view.rows = myRows }
    else { view = { rows: myRows }; container.__nwView = view; views.push(view) }

    var head = h('div', 'nw-lib-head')
    var count = h('div', 'nw-lib-count', lib.count + ' 首 · ' + fmtSize(lib.totalBytes) + ' · 合计 ' + fmtTime(lib.totalDuration))
    var tools = h('div', 'nw-lib-tools')
    var btnAll = h('button', 'nw-tbtn')
    btnAll.type = 'button'
    btnAll.disabled = !lib.count
    btnAll.setAttribute('aria-label', '从头播放全部曲目')
    iconText(btnAll, 'play', '播放全部')
    btnAll.addEventListener('click', function () { shuffle = false; syncModes(); playAt(0) })
    var btnRandom = h('button', 'nw-tbtn')
    btnRandom.type = 'button'
    btnRandom.disabled = !lib.count
    btnRandom.setAttribute('aria-label', '随机播放一首')
    iconText(btnRandom, 'shuffle', '随机播放')
    btnRandom.addEventListener('click', function () { shuffle = true; syncModes(); playAt(Math.floor(Math.random() * queue.length)) })
    var btnRepeat = h('button', 'nw-tbtn')
    btnRepeat.type = 'button'
    btnRepeat.setAttribute('aria-label', '循环模式')
    ui.repeatLabel = btnRepeat
    btnRepeat.addEventListener('click', function () {
      repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'
      syncModes(); persist()
    })
    tools.appendChild(btnAll); tools.appendChild(btnRandom); tools.appendChild(btnRepeat)
    head.appendChild(count); head.appendChild(tools)
    container.appendChild(head)
    syncModes()

    if (!lib.tracks.length) {
      // 空曲库：把"怎么加歌"写清楚，而不是只留一行状态
      var empty = h('div', 'nw-empty')
      var ewrap = h('div', 'nw-empty-icon'); ewrap.appendChild(icon('note'))
      empty.appendChild(ewrap)
      empty.appendChild(h('p', 'nw-empty-title', '曲库里还没有歌'))
      empty.appendChild(h('p', 'nw-empty-tip', '把 .flac / .mp3 / .m4a / .wav / .ogg 等音频放进 NoteWeb\\music\\ 文件夹，然后双击 _打包网站.bat（或运行 npm run music 重新扫描、npm run build 重新打包），刷新本页就会出现。'))
      container.appendChild(empty)
      return
    }

    var searchWrap = h('div', 'nw-lib-search-wrap')
    var sIcon = h('span', 'nw-lib-search-icon'); sIcon.appendChild(icon('search'))
    var search = h('input', 'nw-lib-search')
    search.type = 'search'
    search.placeholder = '搜索歌名、艺术家或文件名…'
    search.autocomplete = 'off'
    search.setAttribute('aria-label', '搜索曲库')
    var clear = h('button', 'nw-lib-clear')
    clear.type = 'button'; clear.title = '清空搜索'; clear.setAttribute('aria-label', '清空搜索')
    clear.appendChild(icon('close'))
    var hint = h('div', 'nw-lib-search-count', '')
    hint.setAttribute('role', 'status')
    hint.setAttribute('aria-live', 'polite')
    searchWrap.appendChild(sIcon); searchWrap.appendChild(search); searchWrap.appendChild(clear); searchWrap.appendChild(hint)
    container.appendChild(searchWrap)

    var list = h('div', 'nw-lib-list')
    lib.tracks.forEach(function (t, i) {
      var row = makeRow(t, i)
      myRows[t.file] = row
      list.appendChild(row)
    })
    container.appendChild(list)

    var foot = h('p', 'nw-lib-foot')
    foot.appendChild(document.createTextNode(COPYRIGHT))
    var stat = []
    if (lib.formats) {
      Object.keys(lib.formats).forEach(function (k) { stat.push(k + ' ' + lib.formats[k] + ' 首') })
    }
    if (stat.length) {
      foot.appendChild(h('br'))
      foot.appendChild(document.createTextNode('格式统计：' + stat.join('、') + (lib.losslessCount ? '，无损 ' + lib.losslessCount + ' 首' : '') + (lib.withCoverCount ? '，含内嵌封面 ' + lib.withCoverCount + ' 首' : '') + '。'))
    }
    if (lib.unplayableCount) {
      foot.appendChild(h('br'))
      foot.appendChild(document.createTextNode('其中有 ' + lib.unplayableCount + ' 首浏览器不能直接播放，已在列表里标明限制，不会被静默排除。'))
    }
    foot.appendChild(h('br'))
    foot.appendChild(document.createTextNode('曲库清单由 scripts/music-scan.mjs 自动扫描生成（npm run music）；想加歌，把文件放进 music 文件夹后重新打包或刷新即可。'))
    container.appendChild(foot)

    var filter = function () {
      var q = search.value.trim().toLowerCase()
      var shown = 0
      lib.tracks.forEach(function (t) {
        var row = myRows[t.file]
        var hay = (t.title + ' ' + (t.artist || '') + ' ' + (t.artistGuessed || '') + ' ' + (t.album || '') + ' ' + t.file).toLowerCase()
        var pass = !q || hay.indexOf(q) !== -1
        row.hidden = !pass
        if (pass) shown++
      })
      searchWrap.classList.toggle('has-value', !!search.value)
      hint.textContent = q ? (shown ? '找到 ' + shown + ' 首' : '没有匹配的曲目') : ''
      return shown
    }
    clear.addEventListener('click', function () { search.value = ''; filter(); search.focus() })
    search.addEventListener('input', filter)
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (search.value) { search.value = ''; filter() } else { search.blur() }
        return
      }
      if (e.key === 'Enter') {
        var first = lib.tracks.findIndex(function (t) { return !myRows[t.file].hidden })
        if (first >= 0) playAt(first)
      }
    })
    highlightRows()
  }

  function highlightRows() {
    var t = track()
    var playing = !!(t && !audio.paused)
    var buffering = !!(t && ui.bar && ui.bar.classList.contains('is-loading'))
    views.forEach(function (v) {
      Object.keys(v.rows).forEach(function (f) {
        var row = v.rows[f]
        var on = !!(t && f === t.file)
        var bad = !!(on && failed[f])
        row.classList.toggle('is-current', on)
        row.classList.toggle('is-playing', on && playing && !bad)
        row.classList.toggle('is-failed', bad)
        var st = row.querySelector('.nw-row-state')
        if (st) {
          st.textContent = ''
          if (on) {
            if (bad) st.textContent = '播放失败'
            else if (playing) {
              if (buffering) st.textContent = '缓冲中…'
              else {
                var eq = h('span', 'nw-eq')
                eq.appendChild(h('i')); eq.appendChild(h('i')); eq.appendChild(h('i'))
                st.appendChild(eq)
                st.appendChild(document.createTextNode('正在播放'))
              }
            } else st.textContent = '已暂停'
          }
        }
        var btn = row.querySelector('.nw-row-play')
        if (btn) {
          var icoEl = btn.querySelector('.nw-row-icon')
          if (icoEl) setIcon(icoEl, on && playing && !bad ? 'pause' : 'play')
          btn.setAttribute('aria-label', (on && playing && !bad ? '暂停 ' : '播放 ') + (row.dataset.index || '') + ' · ' + titleOf(f))
        }
      })
    })
  }
  function titleOf(file) {
    for (var i = 0; i < lib.tracks.length; i++) if (lib.tracks[i].file === file) return lib.tracks[i].title
    return file
  }

  /* ---------------------------- 面板（不中断播放） ---------------------------- */
  function buildPanel() {
    var panel = h('div', 'nw-panel')
    panel.id = 'nw-panel'
    panel.hidden = true
    var head = h('div', 'nw-panel-head')
    var title = h('strong', null, '音乐库')
    var close = h('button', 'nw-btn')
    close.type = 'button'; close.setAttribute('aria-label', '收起曲库面板')
    close.title = '收起'
    close.appendChild(icon('close'))
    close.addEventListener('click', function () { togglePanel(false) })
    head.appendChild(title); head.appendChild(close)
    var body = h('div', 'nw-panel-body')
    panel.appendChild(head); panel.appendChild(body)
    document.body.appendChild(panel)
    ui.panelEl = panel
    ui.panelBody = body
    ui.panelRendered = false
  }
  function togglePanel(force) {
    if (!ui.panelEl) return
    var show = force === undefined ? ui.panelEl.hidden : force
    ui.panelEl.hidden = !show
    if (ui.panel) ui.panel.setAttribute('aria-expanded', show ? 'true' : 'false')
    document.body.classList.toggle('nw-panel-open', show)
    // 面板里的列表按需渲染一次：省掉整页重复的一套 DOM（原来 14 首会渲染成 28 行）
    if (show && !ui.panelRendered && lib) {
      renderLibrary(ui.panelBody, { compact: true })
      ui.panelRendered = true
    }
  }

  /* ---------------------------- 小窗 ---------------------------- */
  function openMiniWindow(e) {
    if (e) e.preventDefault()
    var t = track()
    var u = new URL(ROOT_URL)
    u.searchParams.set('mini', '1')
    // sessionStorage 不跨窗口共享，所以把"接着放哪首、从第几秒"写进网址带过去
    if (t) {
      u.searchParams.set('file', t.file)
      u.searchParams.set('t', String(Math.round(audio.currentTime || 0)))
    }
    var w = window.open(u.href, 'noteweb-music-mini', 'width=460,height=250,menubar=no,toolbar=no,location=no,status=no')
    if (!w) { setStatus('浏览器拦住了小窗，请允许本站弹出窗口', 'error'); return }
    // 交给小窗播放，本页先停下来，避免两个声音一起响
    pause()
    releaseOwnership()
    setStatus('已交给独立小窗播放，翻页不会中断', 'info')
    setTimeout(syncOwnerBanner, 400)
  }

  function syncOwnerBanner() {
    var o = otherOwner()
    if (IS_MINI) {
      // 小窗模式：播放权已经被别的页面抢走，就自己停下来，避免两个声音一起响
      if (o) {
        if (!audio.paused) pause()
        setStatus('播放已转到另一个页面', 'info')
      }
      return
    }
    if (!o) {
      if (ui.ownerBanner) { ui.ownerBanner.hidden = true }
      if (ui.bar) ui.bar.classList.remove('is-owned')
      return
    }
    if (!ui.ownerBanner) {
      var b = h('div', 'nw-owner-banner')
      var txt = h('span', 'nw-owner-text', '')
      var take = h('button', 'nw-btn nw-owner-take', '收回本页播放')
      take.type = 'button'
      take.addEventListener('click', function () {
        var oo = otherOwner()
        releaseOwnership()
        if (oo && oo.file) {
          var pos = queue.findIndex(function (i) { return lib.tracks[i].file === oo.file })
          if (pos >= 0) { loadTrack(pos, { autoplay: true, time: oo.time || 0 }); claimOwnership(true) }
        } else { play() }
        b.hidden = true
      })
      b.appendChild(txt); b.appendChild(take)
      document.body.appendChild(b)
      ui.ownerBanner = b; ui.ownerText = txt
    }
    ui.ownerBanner.hidden = false
    ui.bar.classList.add('is-owned')
    iconText(ui.ownerText, 'headphones', '独立小窗正在播放：' + (o.title || '') + (o.playing ? '' : '（已暂停）'))
  }
  function hideOwnerBannerIfMine() {
    var o = readOwner()
    if (o && o.id === MY_ID && ui.ownerBanner) ui.ownerBanner.hidden = true
  }

  /* ---------------------------- 系统媒体控制 ---------------------------- */
  function updateMediaSession(t) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: t.title,
        artist: t.artist || t.artistGuessed || '未知艺术家',
        album: t.album || '课堂笔记音乐库',
        artwork: [{ src: new URL(coverUrl(t), location.href).href, sizes: '512x512', type: 'image/jpeg' }],
      })
      if (!navigator.mediaSession._nwBound) {
        navigator.mediaSession._nwBound = true
        navigator.mediaSession.setActionHandler('play', function () { play() })
        navigator.mediaSession.setActionHandler('pause', function () { pause() })
        navigator.mediaSession.setActionHandler('previoustrack', function () { prev() })
        navigator.mediaSession.setActionHandler('nexttrack', function () { next(false) })
      }
    } catch (e) { /* 不支持就跳过 */ }
  }

  /* ---------------------------- 启动 ---------------------------- */
  function boot() {
    buildMiniBar()
    bindAudio()
    syncVolume()
    syncModes()

    // 音乐库整页：先给个"正在读取"的占位，避免一片空白
    var pageBody = document.getElementById('nw-library')
    if (pageBody) {
      var loading = h('div', 'nw-lib-loading')
      loading.appendChild(h('span', 'nw-lib-spinner'))
      loading.appendChild(document.createTextNode('正在读取曲库清单…'))
      pageBody.appendChild(loading)
    }

    fetch(BASE + 'library.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(function (data) {
        lib = data
        lib.tracks = lib.tracks || []
        queue = lib.tracks.map(function (_, i) { return i })
        ui.sub.textContent = lib.count + ' 首 · ' + fmtSize(lib.totalBytes)
        ui.play.disabled = lib.count === 0
        if (pageBody) { pageBody.textContent = ''; renderLibrary(pageBody, {}) }
        ui.pageStatus = document.getElementById('nw-music-status')
        if (!IS_MINI) buildPanel()
        // 小窗是被主页面用 ?mini=1&file=…&t=… 打开的：直接接着放那一首
        var handoff = IS_MINI ? params.get('file') : ''
        var startPos = -1
        if (handoff) {
          for (var i = 0; i < lib.tracks.length; i++) if (lib.tracks[i].file === handoff) { startPos = i; break }
        }
        var restored
        if (startPos >= 0) {
          loadTrack(startPos, { autoplay: true, time: Number(params.get('t')) || 0 })
          restored = true
        } else {
          restored = restore()
        }
        if (!restored) setStatus(lib.count ? '点左下角的播放按钮开始播放' : '曲库里还没有歌', lib.count ? 'ready' : 'error')
        syncOwnerBanner()
        setInterval(function () {
          syncOwnerBanner()
          if (IS_MINI || (!audio.paused && track())) heartbeat()
        }, 2500)
      })
      .catch(function (err) {
        ui.sub.textContent = '曲库清单读取失败'
        var msg = '读不到 library.json（' + (err.message || err) + '），请先在 NoteWeb 里跑一次 node scripts/music-scan.mjs'
        setStatus(msg, 'error')
        if (pageBody) {
          pageBody.textContent = ''
          var box = h('div', 'nw-empty')
          var iw = h('div', 'nw-empty-icon'); iw.appendChild(icon('warn'))
          box.appendChild(iw)
          box.appendChild(h('p', 'nw-empty-title', '曲库清单读取失败'))
          box.appendChild(h('p', 'nw-empty-tip', msg))
          pageBody.appendChild(box)
        }
      })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  window.__NOTEWEB_MUSIC__ = {
    get library() { return lib },
    play: play, pause: pause, next: function () { next(false) }, prev: prev,
    playAt: playAt, base: BASE,
  }
})()
