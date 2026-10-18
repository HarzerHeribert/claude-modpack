/* The explainers. Every state an explainer can show is written into the page when the site is built, with numbers
   from facts, the shipped results files and the mods' own code; this script switches between those states and
   animates them. It spells no number of its own in a string (the build checks): the replay's figures come from
   its data, and the eta's job is a simulation that says so. Nothing is fetched; nothing is stored. With reduced
   motion every animation jumps to its end. */
;(function () {
  'use strict'

  var still = window.matchMedia('(prefers-reduced-motion: reduce)')

  // ——————————————————————————————————————— helpers

  function $(root, sel) {
    return root.querySelector(sel)
  }
  function $$(root, sel) {
    return Array.prototype.slice.call(root.querySelectorAll(sel))
  }
  function val(root, key) {
    var on = $$(root, '[data-in="' + key + '"]').filter(function (e) { return e.checked })[0]
    return on ? on.value : undefined
  }
  function wire(root, fn) {
    $$(root, 'input[data-in]').forEach(function (el) { el.addEventListener('change', fn) })
  }
  function data(root) {
    var s = $(root, '.w-data')
    return s ? JSON.parse(s.textContent) : {}
  }
  function whenSeen(el, fn) {
    if (!('IntersectionObserver' in window)) return fn()
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting })) {
        io.disconnect()
        fn()
      }
    }, { threshold: 0.35 })
    io.observe(el)
  }
  function money(x) {
    return '$' + x.toFixed(2)
  }
  function stepsText(x) {
    var v = Math.round(x * 10) / 10
    return (v % 1 ? v.toFixed(1) : String(v)) + (v === 1 ? ' step' : ' steps')
  }
  /** A widget whose states are all in the page: the chosen value goes on the root, and CSS shows that state. */
  function states(root, key, after) {
    function apply() {
      root.setAttribute('data-' + key, val(root, key))
      if (after) after()
    }
    wire(root, apply)
    apply()
  }
  /** A widget with one block per choice: the chosen one shows. */
  function cases(root, key, after) {
    function apply() {
      var v = val(root, key)
      $$(root, '[data-case]').forEach(function (c) { c.hidden = c.getAttribute('data-case') !== v })
      if (after) after(v)
    }
    wire(root, apply)
    apply()
  }
  /** Restart a CSS animation on an element. */
  function restart(el, cls) {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }

  // ——————————————————————————————————————— the landing page: the same job, twice

  function replay(root) {
    var d = data(root)
    var lanes = { plain: $(root, '[data-lane="plain"]'), pack: $(root, '[data-lane="pack"]') }
    var out = $(root, '.rp-out')
    var playBtn = $(root, '[data-act="play"]')
    var timer = null
    var cols = d.jobs.reduce(function (a, j) { return Math.max(a, Math.ceil(j.plain.steps), Math.ceil(j.pack.steps)) }, 1)
    root.style.setProperty('--cols', cols)

    function job() {
      var id = val(root, 'job')
      return d.jobs.filter(function (j) { return j.id === id })[0] || d.jobs[0]
    }
    function blocks(lane, s) {
      var track = $(lane, '.rp-track')
      track.innerHTML = ''
      var whole = Math.ceil(s.steps - 1e-9)
      for (var i = 0; i < whole; i++) {
        var b = document.createElement('span')
        b.className = 'rp-b'
        var part = Math.min(1, s.steps - i)
        if (part < 1) b.style.setProperty('--part', part.toFixed(2))
        track.appendChild(b)
      }
      return whole
    }
    function show(lane, s, k, whole, fresh) {
      $$(lane, '.rp-b').forEach(function (b, i) {
        b.classList.toggle('on', i < k)
        if (fresh && i === k - 1) restart(b, 'fresh')
      })
      var done = k >= whole
      $(lane, '.rp-meter').textContent = money(done ? s.usd : (s.usd / s.steps) * k)
      $(lane, '.rp-count').textContent = done ? stepsText(s.steps) + (Number.isInteger(s.steps) ? '' : ' on average') : k ? stepsText(k) : ''
      lane.classList.toggle('done', done)
    }
    function summary(j) {
      if (Math.abs(j.plain.steps - j.pack.steps) < 0.05) {
        var cost = money(j.plain.usd) === money(j.pack.usd) ? money(j.plain.usd) + ' each' : money(j.plain.usd) + ' and ' + money(j.pack.usd)
        return (j.plain.steps === 1 ? 'One step' : 'The same ' + stepsText(j.plain.steps)) + ' either way, ' + cost + '. There is nothing to take out.'
      }
      return 'Same job, same result: ' + stepsText(j.pack.steps) + ' instead of ' + stepsText(j.plain.steps).replace(/ steps?$/, '') + ', and ' + money(j.pack.usd) + ' instead of ' + money(j.plain.usd) + '.'
    }
    function run(animate) {
      if (timer) clearInterval(timer)
      timer = null
      var j = job()
      var wp = blocks(lanes.plain, j.plain)
      var wk = blocks(lanes.pack, j.pack)
      var end = Math.max(wp, wk)
      if (!animate || still.matches) {
        show(lanes.plain, j.plain, wp, wp)
        show(lanes.pack, j.pack, wk, wk)
        out.textContent = summary(j)
        root.classList.remove('playing')
        return
      }
      var t = 0
      out.textContent = ''
      root.classList.add('playing')
      show(lanes.plain, j.plain, 0, wp)
      show(lanes.pack, j.pack, 0, wk)
      timer = setInterval(function () {
        t += 1
        show(lanes.plain, j.plain, Math.min(t, wp), wp, t <= wp)
        show(lanes.pack, j.pack, Math.min(t, wk), wk, t <= wk)
        if (t >= end) {
          clearInterval(timer)
          timer = null
          out.textContent = summary(j)
          root.classList.remove('playing')
        }
      }, 460)
    }
    wire(root, function () { run(true) })
    playBtn.addEventListener('click', function () { run(true) })
    run(false)
    whenSeen(root, function () { run(true) })
  }

  // ——————————————————————————————————————— cells, seek: before and after

  function beforeAfter(root) {
    states(root, 'mode')
  }

  // ——————————————————————————————————————— delegate: one hand-off, step by step

  function delegate(root) {
    var list = $$(root, '.dg-step')
    var timer = null
    states(root, 'tests')
    function reveal(animate) {
      if (timer) clearInterval(timer)
      timer = null
      if (!animate || still.matches) {
        list.forEach(function (s) { s.classList.remove('waiting') })
        return
      }
      var k = 0
      list.forEach(function (s, i) { s.classList.toggle('waiting', i > 0) })
      restart(list[0], 'arrive')
      timer = setInterval(function () {
        k += 1
        if (k >= list.length) {
          clearInterval(timer)
          timer = null
          return
        }
        list[k].classList.remove('waiting')
        restart(list[k], 'arrive')
      }, 1100)
    }
    $(root, '[data-act="play"]').addEventListener('click', function () { reveal(true) })
    wire(root, function () {
      // A changed verdict is seen at once: the last two steps arrive again.
      list.slice(-2).forEach(function (s) { if (!still.matches) restart(s, 'arrive') })
    })
  }

  // ——————————————————————————————————————— route, statusline: one case per choice

  function oneOf(root) {
    var key = $(root, 'input[data-in]').getAttribute('data-in')
    // A phone cannot show a wide terminal: the status line starts at the width it can show.
    var narrow = $(root, 'input[data-in="width"][value="narrow"]')
    if (narrow && root.getBoundingClientRect().width < 520) narrow.checked = true
    cases(root, key)
  }

  // ——————————————————————————————————————— smart-compact: the clock runs while you are away

  function smartcompact(root) {
    cases(root, 'away', function (v) {
      var c = $(root, '[data-case="' + v + '"]')
      if (c && !still.matches) $$(c, '.sc-needle').forEach(function (nd) { restart(nd, 'run') })
    })
  }

  // ——————————————————————————————————————— eta: a job's row above the prompt (its table.ts, ported)

  function eta(root) {
    var band = $(root, '.eta-band')
    var out = $(root, '.eta-out')
    var SPIN = ['◐', '◓', '◑', '◒']
    var CELLS = 12
    var TOTAL = 50
    var JOB_MS = 6 * 60e3 // the simulated job's length
    var REAL_MS = 6500 // how long the simulation takes on the page
    var timer = null
    function pad(x) {
      return (x < 10 ? '0' : '') + x // num-ok: a clock's leading zero
    }
    function hhmm(ms) {
      var d = new Date(ms)
      return pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    function mins(ms) {
      return Math.max(1, Math.round(ms / 60e3)) + 'm'
    }
    function gauge(frac) {
      var halves = Math.round(Math.min(1, Math.max(0, frac)) * CELLS * 2)
      var on = ''
      var off = ''
      for (var i = 0; i < CELLS; i++) {
        var f = Math.min(2, Math.max(0, halves - i * 2))
        if (f === 2) on += '━'
        else if (f === 1) on += '╸'
        else off += '─'
      }
      return '<span class="t-accent">' + on + '</span><span class="t-faint">' + off + '</span>'
    }
    function pct(frac) {
      var p = String(Math.floor(frac * 100))
      while (p.length < String(100).length) p = ' ' + p
      return p + '%'
    }
    var name = '<span class="t-text">stress tests</span>'
    function draw(s) {
      if (s.state === 'idle') band.innerHTML = '<span class="t-faint">no background jobs</span>'
      else if (s.state === 'running') {
        var spin = '<span class="t-accent">' + SPIN[Math.floor(s.real / 250) % SPIN.length] + '</span>'
        var eta = s.at ? '<span class="t-label">' + hhmm(s.at) + '  in ' + mins(s.at - s.now) + '</span>' : '<span class="t-faint">measuring</span>'
        band.innerHTML = [spin, name, gauge(s.frac), '<span class="t-text">' + pct(s.frac) + '</span>', '<span class="t-label">' + s.done + '/' + TOTAL + '</span>', eta].join('  ')
      } else if (s.state === 'beat') band.innerHTML = ['<span class="t-good">✓</span>', name, gauge(1), '<span class="t-text">' + pct(1) + '</span>', '<span class="t-label">' + TOTAL + '/' + TOTAL + '</span>'].join('  ')
      else if (s.state === 'gone') band.innerHTML = '<span class="t-faint">the finished job has left</span>'
      else if (s.state === 'failed') band.innerHTML = ['<span class="t-bad">✕</span>', name, '<span class="t-bad">failed ' + hhmm(s.now) + '</span>', '<span class="t-label">after ' + mins(s.now - s.start) + '</span>'].join('  ')
    }
    function play() {
      if (timer) clearInterval(timer)
      var fails = val(root, 'end') === 'fail'
      var t0 = Date.now()
      var start = Date.now()
      out.textContent = 'The job runs in the background; eta reads its output and fills the bar.'
      function tick() {
        var real = Date.now() - t0
        var frac = Math.min(1, real / REAL_MS)
        var now = start + frac * JOB_MS
        if (fails && frac >= 0.7) {
          clearInterval(timer)
          timer = null
          draw({ state: 'failed', now: now, start: start })
          out.textContent = 'A failure stays above the prompt, in red, until you write again.'
          return
        }
        if (frac >= 1) {
          clearInterval(timer)
          timer = null
          draw({ state: 'beat' })
          out.textContent = 'Done: the full bar shows for a moment, then the job leaves.'
          setTimeout(function () { if (!timer) draw({ state: 'gone' }) }, 1400)
          return
        }
        var done = Math.floor(frac * TOTAL)
        var f = done / TOTAL
        draw({ state: 'running', frac: f, done: done, at: done > 2 ? start + (now - start) / f : null, now: now, real: real })
      }
      if (still.matches) {
        t0 = Date.now() - REAL_MS * 0.66
        tick()
        return
      }
      timer = setInterval(tick, 100)
      tick()
    }
    $(root, '[data-act="play"]').addEventListener('click', play)
    draw({ state: 'idle' })
  }

  // ——————————————————————————————————————— modpack: a hook that hangs

  function modpack(root) {
    var d = data(root)
    var GUARD = d.guard
    var SHOWN = GUARD * 7 // seconds the race shows: long past the guard
    var SPEED = 9 // simulated seconds per real second
    var lanes = { off: $(root, '[data-lane="off"]'), on: $(root, '[data-lane="on"]') }
    var running = null
    function draw(s) {
      $(lanes.off, 'i').style.width = ((s / SHOWN) * 100).toFixed(1) + '%'
      $(lanes.off, '.mp-t').textContent = s >= SHOWN ? 'still waiting, Claude Code frozen' : 'waiting ' + Math.floor(s) + ' s'
      var on = Math.min(s, GUARD)
      $(lanes.on, 'i').style.width = ((on / SHOWN) * 100).toFixed(1) + '%'
      $(lanes.on, '.mp-t').textContent = s >= GUARD ? 'stopped waiting after ' + GUARD + ' s, and asked you' : 'waiting ' + Math.floor(s) + ' s'
      lanes.on.classList.toggle('done', s >= GUARD)
    }
    $(root, '[data-act="play"]').addEventListener('click', function () {
      if (running) cancelAnimationFrame(running)
      if (still.matches) return draw(SHOWN)
      var t0 = performance.now()
      var step = function (now) {
        var s = Math.min(SHOWN, ((now - t0) / 1000) * SPEED)
        draw(s)
        running = s < SHOWN ? requestAnimationFrame(step) : null
      }
      running = requestAnimationFrame(step)
    })
    draw(0)
    $(lanes.off, '.mp-t').textContent = ''
    $(lanes.on, '.mp-t').textContent = ''
  }

  // ——————————————————————————————————————— ideas: a token's life

  function token(root) {
    var dots = $$(root, '.tk-dots i')
    function play() {
      if (still.matches) return
      restart(root, 'run')
      dots.forEach(function (d, i) { d.style.animationDelay = (i * 18) + 'ms' })
    }
    $(root, '[data-act="play"]').addEventListener('click', play)
    whenSeen(root, play)
  }

  var WIDGETS = { replay: replay, cells: beforeAfter, seek: beforeAfter, delegate: delegate, route: oneOf, statusline: oneOf, smartcompact: smartcompact, eta: eta, modpack: modpack, token: token }

  function init() {
    $$(document, '.widget[data-widget]').forEach(function (el) {
      var fn = WIDGETS[el.getAttribute('data-widget')]
      if (!fn) return
      try {
        fn(el)
        el.classList.add('live')
      } catch (e) {
        if (window.console) console.error('widget ' + el.getAttribute('data-widget'), e)
      }
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
