/* What every page does: the theme, how numbers read (in words or exactly), copy buttons, recordings that play on
   request, and the contents on the right following the reader. The only storage is the reader's two choices. */
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
        var text = el.textContent.trim()
        var done = function () {
          b.setAttribute('data-done', '')
          b.setAttribute('aria-label', 'Copied')
          var label = b.querySelector('span')
          if (label) label.textContent = 'Copied'
          setTimeout(function () {
            b.removeAttribute('data-done')
            b.setAttribute('aria-label', 'Copy the install command')
            if (label) label.textContent = 'Copy'
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
