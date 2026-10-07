/* ==========================================================================
   课堂笔记网站 —— 前端交互
   纯原生 JavaScript，不依赖任何外部库，离线也能跑。
   ========================================================================== */
(function () {
  'use strict'

  var $ = function (sel, root) { return (root || document).querySelector(sel) }
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  /* ---------------- 深色 / 浅色模式 ---------------- */
  function initTheme() {
    var btns = $$('#theme-btn')
    if (!btns.length) return
    var sync = function () {
      var dark = document.documentElement.dataset.theme === 'dark'
      /* 代码高亮的两套配色靠 media 切换，手动切主题时要显式打开对应的那一套 */
      $$('link[data-hljs-theme]').forEach(function (link) {
        var want = link.dataset.hljsTheme === 'dark'
        link.disabled = dark ? !want : want
      })
      btns.forEach(function (btn) {
        btn.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式')
        btn.title = dark ? '切换到浅色模式' : '切换到深色模式'
        var icon = btn.querySelector('.theme-icon')
        var label = btn.querySelector('.theme-label')
        if (icon) icon.textContent = dark ? '☀' : '🌙'
        else if (!label) btn.textContent = dark ? '☀' : '🌙'
        if (label) label.textContent = dark ? '浅色模式' : '深色模式'
      })
    }
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dark = document.documentElement.dataset.theme === 'dark'
        if (dark) delete document.documentElement.dataset.theme
        else document.documentElement.dataset.theme = 'dark'
        try { localStorage.setItem('noteweb-theme', dark ? 'light' : 'dark') } catch (e) {}
        sync()
      })
    })
    sync()
  }

  /* ---------------- 手机端侧边栏 ---------------- */
  function initDrawer() {
    var sidebar = $('#sidebar')
    var scrim = $('#scrim')
    var btn = $('#menu-btn')
    if (!sidebar || !btn) return
    var close = function () {
      sidebar.classList.remove('open')
      if (scrim) scrim.hidden = true
    }
    btn.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open')
      if (scrim) scrim.hidden = !open
    })
    if (scrim) scrim.addEventListener('click', close)
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close() })
  }

  /* ---------------- 侧边导航：分组折叠 ---------------- */
  function initGroups() {
    var groups = $$('.nav-group')
    // 默认全部展开，方便一眼看到所有笔记
    groups.forEach(function (g) { g.classList.add('open') })
    // 当前所在的分组提到最上面
    var active = $('.nav-list li.active')
    if (active) {
      var g = active.closest('.nav-group')
      if (g) {
        g.parentNode.insertBefore(g, g.parentNode.firstChild)
      }
      // 当前笔记滚动到可见位置
      window.requestAnimationFrame(function () {
        if (active.offsetTop > 320) active.scrollIntoView({ block: 'center' })
      })
    }
    $$('.nav-course').forEach(function (b) {
      b.addEventListener('click', function () {
        b.closest('.nav-group').classList.toggle('open')
      })
    })
  }

  /* ---------------- 侧边栏搜索 ---------------- */
  function initSearch() {
    var input = $('#search')
    if (!input) return
    var items = $$('.nav-list li')
    var counts = $('#search-count')
    var empty = $('#nav-empty')

    var run = function () {
      var q = input.value.trim().toLowerCase()
      var shown = 0
      items.forEach(function (li) {
        var link = li.querySelector('a')
        var text = (link && link.dataset.text) || ''
        var ok = !q || text.indexOf(q) !== -1
        li.hidden = !ok
        if (ok) shown++
      })
      $$('.nav-group').forEach(function (g) {
        var visible = $$('.nav-list li', g).filter(function (li) { return !li.hidden })
        g.hidden = visible.length === 0
        // 搜索时自动展开有结果的分组
        if (q) g.classList.add('open')
      })
      if (counts) counts.textContent = q ? '找到 ' + shown + ' 篇' : ''
      if (empty) empty.hidden = shown !== 0 || !q
    }

    input.addEventListener('input', run)
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== input) {
        e.preventDefault()
        input.focus()
        input.select()
      } else if (e.key === 'Escape' && document.activeElement === input) {
        input.value = ''
        run()
        input.blur()
      }
    })
  }

  /* ---------------- 正文里的标题锚点 ---------------- */
  function initAnchors() {
    $$('.article-body h2, .article-body h3, .article-body h4').forEach(function (h) {
      if (!h.id) return
      var a = document.createElement('a')
      a.className = 'anchor'
      a.href = '#' + h.id
      a.textContent = '#'
      a.setAttribute('aria-label', '链接到这一段')
      h.insertBefore(a, h.firstChild)
    })
  }

  /* ---------------- 代码块「复制」按钮 ---------------- */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var block = btn.closest('.code-block')
        var code = block && block.querySelector('code')
        if (!code) return
        var text = code.innerText
        var done = function () {
          btn.textContent = '已复制'
          btn.classList.add('done')
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done') }, 1600)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback)
        } else {
          fallback()
        }
        function fallback() {
          var ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          try { document.execCommand('copy'); done() } catch (e) { btn.textContent = '复制失败' }
          document.body.removeChild(ta)
        }
      })
    })
  }

  /* ---------------- 阅读进度条 + 回到顶部 ---------------- */
  function initScroll() {
    var bar = $('#progress')
    var top = $('#to-top')
    var update = function () {
      var h = document.documentElement
      var max = h.scrollHeight - h.clientHeight
      var y = h.scrollTop || document.body.scrollTop
      if (bar) bar.style.width = max > 0 ? (y / max) * 100 + '%' : '0'
      if (top) top.hidden = y < 400
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    if (top) top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }) })
  }

  /* ---------------- 实时刷新：笔记文件一改，页面自动重载 ----------------
     只在「本地服务器模式」下生效（静态部署的网站上没有这个接口，会自动跳过）。 */
  function initLiveReload() {
    if (document.body.dataset.autoRefresh !== '1') return
    if (typeof EventSource === 'undefined') return
    var port = document.body.dataset.port || location.port || '80'
    var badge = $('#live-badge')
    try {
      var es = new EventSource('/__live?port=' + encodeURIComponent(port))
      var pending = false
      es.addEventListener('changed', function () {
        if (pending) return
        pending = true
        if (badge) badge.textContent = '正在刷新…'
        setTimeout(function () { location.reload() }, 150)
      })
      es.onerror = function () { /* 服务器关了或静态托管：静默忽略 */ }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    initTheme()
    initDrawer()
    initGroups()
    initSearch()
    initAnchors()
    initCopy()
    initScroll()
    initLiveReload()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
