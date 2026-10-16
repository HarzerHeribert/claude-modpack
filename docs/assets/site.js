/* What every page does: the theme, the reading mode (plain words or hard numbers), copy buttons, recordings that
   play on request, the contents on the right following the reader, and the status line at the bottom of the window,
   fitted to its width by the statusline mod's own rule. The only storage is the reader's two choices. */
;(function () {
  'use strict'
  var root = document.documentElement
  var dark = window.matchMedia('(prefers-color-scheme: dark)')
  var store = {
    get: function (k) {
      try { return localStorage.getItem(k) } catch (e) { return null }
    },
    set: function (k, v) {
      try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {}
    },
  }

  // ——————————————————————————————————————— theme

  function theme() {
    var set = root.getAttribute('data-theme')
    return set === 'light' || set === 'dark' ? set : dark.matches ? 'dark' : 'light'
  }
  function themeLabels() {
    var next = theme() === 'dark' ? 'light' : 'dark'
    document.querySelectorAll('.theme-btn').forEach(function (b) {
      b.setAttribute('aria-label', 'Switch to ' + next + ' theme')
      b.setAttribute('title', 'Switch to ' + next + ' theme')
    })
  }

  // ——————————————————————————————————————— reading mode

  function mode() {
    return root.getAttribute('data-mode') === 'numbers' ? 'numbers' : 'plain'
  }
  function modeButtons() {
    document.querySelectorAll('.mode [data-set-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-mode') === mode()))
    })
  }
  function setMode(m, reveal) {
    root.setAttribute('data-mode', m)
    store.set('modpack-mode', m)
    modeButtons()
    document.dispatchEvent(new CustomEvent('modechange'))
    if (reveal) {
      var first = document.querySelector('main .only-' + m)
      if (first) first.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
  }

  // ——————————————————————————————————————— the contents on the right

  function contents() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[data-for]'))
    if (!links.length) return
    var heads = []
    function refresh() {
      heads = []
      links.forEach(function (l) {
        var h = document.getElementById(l.getAttribute('data-for'))
        var shown = !!h && h.offsetParent !== null
        l.parentNode.hidden = !shown
        if (shown) heads.push([h, l])
      })
      mark()
    }
    function mark() {
      var y = window.scrollY + 120
      var at = null
      heads.forEach(function (p) {
        if (p[0].getBoundingClientRect().top + window.scrollY <= y) at = p[1]
      })
      if (!at && heads.length) at = heads[0][1]
      links.forEach(function (l) {
        l.classList.toggle('active', l === at)
      })
    }
    refresh()
    document.addEventListener('modechange', refresh)
    window.addEventListener('scroll', function () { requestAnimationFrame(mark) }, { passive: true })
  }

  // ——————————————————————————————————————— the status line (statusline's fit(), ported)

  function statusLine() {
    var bar = document.querySelector('.sl')
    if (!bar) return
    var left = bar.querySelector('.sl-l')
    var right = bar.querySelector('.sl-r')
    var SEP = '   '
    var probe = document.createElement('span')
    probe.textContent = '0000000000'
    probe.style.cssText = 'position:absolute;visibility:hidden'
    bar.appendChild(probe)
    var ch = probe.getBoundingClientRect().width / 10 || 7.2
    bar.removeChild(probe)
    var path = bar.getAttribute('data-path')
    var parts = ['claude-modpack'].concat(path ? path.split('/') : [])
    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') }
    var seg = function (name, priority, html, text, shortHtml, shortText) {
      return { name: name, priority: priority, html: html, w: Array.from(text).length, short: shortHtml ? { html: shortHtml, w: Array.from(shortText).length } : null }
    }
    function gauge(frac, cells) {
      var halves = Math.round(Math.min(1, Math.max(0, frac)) * cells * 2)
      var on = ''
      var off = ''
      for (var i = 0; i < cells; i++) {
        var f = Math.min(2, Math.max(0, halves - i * 2))
        if (f === 2) on += '━'
        else if (f === 1) on += '╸'
        else off += '─'
      }
      return '<span class="on">' + on + '</span><span class="off">' + off + '</span>'
    }
    function render() {
      var max = document.documentElement.scrollHeight - window.innerHeight
      var frac = max > 0 ? window.scrollY / max : 1
      var pct = Math.round(frac * 100) + '%'
      var where = parts.join('/')
      var segs = [
        seg('path', 0, '<span class="sl-mode">⏵⏵ </span>' + esc(parts.slice(0, -1).join('/')) + (parts.length > 1 ? '/' : '') + '<b>' + esc(parts[parts.length - 1]) + '</b>', '⏵⏵ ' + where, '<span class="sl-mode">⏵⏵ </span><b>' + esc(parts[parts.length - 1]) + '</b>', '⏵⏵ ' + parts[parts.length - 1]),
        seg('mode', 4, (mode() === 'numbers' ? 'hard numbers' : 'plain words'), mode() === 'numbers' ? 'hard numbers' : 'plain words'),
        seg('mods', 5, '<span class="val">' + bar.getAttribute('data-mods') + '</span> mods', bar.getAttribute('data-mods') + ' mods'),
        seg('claims', 3, '<span class="val">' + bar.getAttribute('data-claims') + '</span> claims', bar.getAttribute('data-claims') + ' claims'),
        seg('read', 1, 'read ' + gauge(frac, 10) + ' <span class="val">' + pct + '</span>', 'read ' + '──────────' + ' ' + pct, '<span class="val">' + pct + '</span>', pct),
        seg('runs', 2, '<span class="ok-dot">●</span> ' + esc(bar.getAttribute('data-runs')) + ' runs, all correct', '● ' + bar.getAttribute('data-runs') + ' runs, all correct', '<span class="ok-dot">●</span> all correct', '● all correct'),
      ]
      var room = Math.floor((bar.clientWidth - 32) / ch)
      var kept = segs.slice()
      var total = function () {
        return kept.reduce(function (a, s) { return a + s.w }, 0) + Math.max(0, kept.length - 1) * SEP.length
      }
      while (kept.length && total() > room) {
        var worst = kept.reduce(function (a, b) { return b.priority >= a.priority ? b : a })
        var at = kept.indexOf(worst)
        if (worst.short) kept[at] = { name: worst.name, priority: worst.priority, html: worst.short.html, w: worst.short.w, short: null }
        else kept.splice(at, 1)
      }
      var p = kept.find(function (s) { return s.name === 'path' })
      left.innerHTML = p ? p.html : ''
      right.innerHTML = kept.filter(function (s) { return s.name !== 'path' }).map(function (s) { return s.html }).join(SEP)
    }
    var queued = false
    var later = function () {
      if (queued) return
      queued = true
      requestAnimationFrame(function () {
        queued = false
        render()
      })
    }
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    document.addEventListener('modechange', later)
    render()
  }

  function init() {
    themeLabels()
    dark.addEventListener('change', themeLabels)
    document.querySelectorAll('.theme-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = theme() === 'dark' ? 'light' : 'dark'
        if ((next === 'dark') === dark.matches) root.removeAttribute('data-theme')
        else root.setAttribute('data-theme', next)
        store.set('modpack-theme', root.hasAttribute('data-theme') ? next : null)
        themeLabels()
        document.dispatchEvent(new CustomEvent('themechange'))
      })
    })

    modeButtons()
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-set-mode]')
      if (!b) return
      setMode(b.getAttribute('data-set-mode'), !b.closest('.mode'))
    })

    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var el = document.querySelector(b.getAttribute('data-copy'))
        if (!el) return
        var text = el.textContent.replace(/^›/, '').trim()
        var done = function () {
          b.setAttribute('data-done', '')
          b.setAttribute('aria-label', 'Copied')
          setTimeout(function () {
            b.removeAttribute('data-done')
            b.setAttribute('aria-label', 'Copy the install command')
          }, 1800)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {})
      })
    })

    // A recording shows its still frame until asked: nothing moves, and nothing heavy loads, before a click.
    document.querySelectorAll('.rec-play').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault()
        var img = a.querySelector('img')
        if (a.classList.contains('playing')) {
          img.src = img.getAttribute('data-poster')
          a.classList.remove('playing')
          a.removeAttribute('aria-label')
          return
        }
        img.setAttribute('data-poster', img.getAttribute('src'))
        img.src = a.getAttribute('data-gif')
        a.classList.add('playing')
        a.setAttribute('aria-label', 'Recording playing; activate to stop')
      })
    })

    // The phone's menu closes on Escape and when a link in it is followed.
    var menu = document.querySelector('.m-nav')
    if (menu) {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menu.open) {
          menu.open = false
          menu.querySelector('summary').focus()
        }
      })
      menu.addEventListener('click', function (e) {
        if (e.target.closest('a')) menu.open = false
      })
    }
    document.querySelectorAll('.toc-mobile a').forEach(function (a) {
      a.addEventListener('click', function () { a.closest('details').open = false })
    })

    contents()
    statusLine()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
