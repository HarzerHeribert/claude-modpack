/* The explainers. Each one is built from a mod's own rules, ported from its source, or from measured numbers the page
   hands over (a .w-data script). Prices are Opus 5.5's list prices. Nothing is fetched; nothing is stored. */
;(function () {
  'use strict'

  var P = { read: 0.2, write: 8, input: 4, output: 20 } // $ per million tokens
  var M = 1e6
  var still = window.matchMedia('(prefers-reduced-motion: reduce)')
  var NS = 'http://www.w3.org/2000/svg'
  var MINUS = '−'

  // ——————————————————————————————————————— helpers

  function $(root, sel) {
    return root.querySelector(sel)
  }
  function $$(root, sel) {
    return Array.prototype.slice.call(root.querySelectorAll(sel))
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function usd(x) {
    if (x === 0) return '$0'
    if (x < 0.01) return '$' + x.toFixed(3)
    if (x < 100) return '$' + x.toFixed(2)
    return '$' + Math.round(x)
  }
  function tok(n) {
    if (n >= M) return (n / M).toFixed(n % M === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M'
    if (n >= 1000) return Math.round(n / 1000) + 'k'
    return String(n)
  }
  function num(n) {
    return Math.round(n).toLocaleString('en-US')
  }
  function val(root, key) {
    var els = $$(root, '[data-in="' + key + '"]')
    if (!els.length) return undefined
    if (els[0].type === 'radio') {
      var on = els.find(function (e) {
        return e.checked
      })
      return on ? on.value : undefined
    }
    return els[0].type === 'range' ? Number(els[0].value) : els[0].value
  }
  function out(root, key, text) {
    var o = $(root, '[data-o="' + key + '"]')
    if (o) o.textContent = text
  }
  function wire(root, render) {
    $$(root, '[data-in]').forEach(function (el) {
      el.addEventListener(el.type === 'range' ? 'input' : 'change', render)
    })
  }
  function data(root) {
    var s = $(root, '.w-data')
    return s ? JSON.parse(s.textContent) : {}
  }
  function width(el) {
    return Math.max(260, Math.round(el.getBoundingClientRect().width))
  }
  function onResize(el, fn) {
    if (!('ResizeObserver' in window)) return
    var last = 0
    new ResizeObserver(function () {
      var w = width(el)
      if (Math.abs(w - last) > 4) {
        last = w
        fn()
      }
    }).observe(el)
  }
  /** Run `fn` once the element is first in view (so an animation is seen), at once without IntersectionObserver. */
  function whenSeen(el, fn) {
    if (!('IntersectionObserver' in window)) return fn()
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting })) {
        io.disconnect()
        fn()
      }
    }, { threshold: 0.25 })
    io.observe(el)
  }

  var CTX = [10e3, 20e3, 50e3, 100e3, 150e3, 220e3, 300e3, 400e3, 600e3, 800e3, 1e6]

  // ——————————————————————————————————————— every step re-reads everything

  function rereader(root) {
    var ADD = [0, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000]
    var svg = $(root, '.rr-svg')
    var animate = false
    function render() {
      var C = CTX[val(root, 'ctx')]
      var n = val(root, 'steps')
      var A = ADD[val(root, 'add')]
      out(root, 'ctx', tok(C) + ' tokens')
      out(root, 'steps', String(n))
      out(root, 'add', A ? tok(A) + ' tokens' : 'nothing')
      var cost = function (k) {
        var s = 0
        for (var i = 0; i < k; i++) s += ((C + i * A) * P.read) / M
        return s
      }
      var total = cost(n)
      var added = (A * (n * (n - 1)) / 2 * P.read) / M
      var fewer = Math.min(3, n - 1)
      var saved = total - cost(n - fewer)
      $(root, '.w-out').innerHTML =
        'Each step re-reads the <b>' + tok(C) + '</b> tokens already there: <b>' + usd((C * P.read) / M) + '</b> before it does any work. ' +
        '<b>' + n + ' step' + (n > 1 ? 's' : '') + '</b> re-read <b>' + usd(total) + '</b> in all' + (A && n > 1 ? ', <b>' + usd(added) + '</b> of it what the steps themselves added' : '') + '. ' +
        (fewer > 0 ? (fewer === 1 ? 'One step' : fewer === 2 ? 'Two steps' : 'Three steps') + ' fewer would save <b>' + usd(saved) + '</b>.' : '') +
        ' Without the cache, every figure would be 20 times as large.'

      var W = width(svg.parentNode) - 24
      var H = 220
      var pad = { l: 44, r: 8, t: 10, b: 24 }
      var top = Math.max(100e3, C + (n - 1) * A)
      var stepT = [25e3, 50e3, 100e3, 200e3, 250e3, 500e3].find(function (s) { return top / s <= 4.2 }) || 500e3
      var yMax = Math.ceil((top * 1.08) / stepT) * stepT
      var bw = (W - pad.l - pad.r) / 16
      var y = function (v) {
        return pad.t + (H - pad.t - pad.b) * (1 - Math.min(v, yMax) / yMax)
      }
      var parts = []
      for (var tk = stepT; tk <= yMax; tk += stepT) (function (t) {
        parts.push('<line class="axis-l" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke-opacity="0.5"/>')
        parts.push('<text class="axis-t" x="' + (pad.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + tok(t) + '</text>')
      })(tk)
      for (var i = 0; i < 16; i++) {
        var x = pad.l + i * bw + bw * 0.14
        var w = bw * 0.72
        if (i >= n) {
          parts.push('<rect class="bar-ghost" x="' + x + '" y="' + (H - pad.b - 3) + '" width="' + w + '" height="3" rx="1.5"/>')
          continue
        }
        var base = Math.max(2, y(0) - y(C))
        var add = y(C) - y(C + i * A)
        var delay = animate && !still.matches ? ' style="animation-delay:' + i * 45 + 'ms"' : ''
        var cls = animate && !still.matches ? ' grow-in' : ''
        parts.push('<g class="' + cls.trim() + '"' + delay + '><rect class="bar-base" x="' + x + '" y="' + (y(0) - base) + '" width="' + w + '" height="' + base + '" rx="2"/>' + (add > 0.5 ? '<rect class="bar-added" x="' + x + '" y="' + (y(0) - base - add) + '" width="' + w + '" height="' + add + '" rx="2"/>' : '') + '</g>')
        if (i === 0 || i === n - 1) parts.push('<text class="axis-t" x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + (i + 1) + '</text>')
      }
      parts.push('<text class="axis-t" x="' + (W - pad.r) + '" y="' + (H - 6) + '" text-anchor="end">step</text>')
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
      svg.innerHTML = parts.join('')
      animate = false
    }
    wire(root, function () {
      render()
    })
    render()
    whenSeen(root, function () {
      animate = true
      render()
    })
    onResize(svg.parentNode, render)
  }

  // ——————————————————————————————————————— fewer steps, same work (measured)

  function steps(root) {
    var d = data(root)
    var box = $(root, '.steps-rows')
    var seen = false
    function render() {
      var t =
        d.tasks.find(function (x) {
          return x.id === val(root, 'task')
        }) || d.tasks[0]
      var long = val(root, 'session') === 'long'
      var plain = t.cells[long ? 2 : 0]
      var pack = t.cells[long ? 3 : 1]
      var anim = seen && !still.matches
      var row = function (who, c, color, name, sub) {
        var dots = []
        var whole = Math.ceil(c.n)
        for (var i = 0; i < whole; i++) {
          var part = Math.min(1, c.n - i)
          dots.push('<span class="st-dot' + (anim ? ' on' : '') + '" style="--c:' + color + (anim ? ';animation-delay:' + i * 110 + 'ms' : '') + '"><i style="width:' + Math.round(part * 100) + '%"></i></span>')
        }
        return '<div class="st-row"><span class="st-name">' + name + '<small>' + sub + '</small></span><span class="st-dots" aria-hidden="true">' + dots.join('') + '</span><span class="st-val"><b>' + c.requests + ' requests</b><small>' + c.cost + ' a run</small></span></div>'
      }
      box.innerHTML =
        row('plain', plain, 'var(--plain)', 'Plain Claude Code', long ? 'session had read the code' : 'fresh session') +
        row('pack', pack, 'var(--pack)', 'With the pack', long ? 'session had read the code' : 'fresh session') +
        '<p class="st-diff">' + esc(t.name) + ', ' + (long ? 'long' : 'fresh') + ' session: ' + plain.requests + ' → ' + pack.requests + ' requests, ' + plain.cost + ' → ' + pack.cost + ' a run. Each dot is one request of the main model.</p>'
    }
    wire(root, render)
    render()
    whenSeen(root, function () {
      seen = true
      render()
    })
  }

  // ——————————————————————————————————————— what a step leaves behind

  function carry(root) {
    var TOK = [500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 50000]
    var svg = $(root, '.carry-svg')
    function render() {
      var T = TOK[val(root, 'tokens')]
      var L = val(root, 'later')
      var C = CTX[val(root, 'ctx')]
      out(root, 'tokens', num(T) + ' tokens')
      out(root, 'later', String(L))
      out(root, 'ctx', tok(C) + ' tokens')
      var write = (T * P.write) / M
      var reread = (T * L * P.read) / M
      var life = write + reread
      var step = (C * P.read) / M
      var perM = P.write + P.read * L
      var max = Math.max(write, reread, step, 1e-9)
      var bar = function (label, v, cls) {
        return '<div class="cb-row"><span>' + label + '</span><span class="cb-track"><i class="' + cls + '" style="width:' + ((v / max) * 100).toFixed(2) + '%"></i></span><span class="cb-v">' + usd(v) + '</span></div>'
      }
      $(root, '.carry-bars').innerHTML =
        bar('The step itself: one re-read of the context', step, 'cb-step') +
        bar('Writing what it left, once', write, 'cb-write') +
        bar('Re-reading it in ' + L + ' later requests', reread, 'cb-carry')
      $(root, '.w-out').innerHTML =
        'A step that leaves <b>' + num(T) + '</b> tokens behind pays <b>' + usd(write) + '</b> to write them once, then <b>' + usd(reread) + '</b> as ' + L + ' later requests read them again: <b>' + usd(life) + '</b> over their life' +
        (write > 0 ? ', ' + (life / write).toFixed(1) + ' times the writing' : '') + ' (' + usd(perM) + ' per million tokens). ' +
        (reread + write > step ? 'That is more than the step itself, whose re-read of ' + tok(C) + ' tokens cost ' + usd(step) + '.' : 'Here the step itself, a re-read of ' + tok(C) + ' tokens at ' + usd(step) + ', costs more.')

      var W = width(svg.parentNode) - 24
      var H = 120
      var parts = []
      var n = Math.max(1, L)
      var x0 = 70
      var cw = (W - x0 - 8) / Math.max(n, 1)
      parts.push('<rect class="bar-plain" x="8" y="36" width="44" height="48" rx="4"/><text class="svg-t" x="30" y="102" text-anchor="middle">the step</text>')
      for (var i = 0; i < L; i++) {
        parts.push('<rect class="bar-added" x="' + (x0 + i * cw) + '" y="46" width="' + Math.max(0.6, cw - (cw > 3 ? 1 : 0)) + '" height="28" rx="' + (cw > 4 ? 1.5 : 0) + '"/>')
      }
      if (L === 0) parts.push('<text class="svg-t" x="' + x0 + '" y="64">compacted at once: nothing is read again</text>')
      parts.push('<text class="svg-t" x="' + x0 + '" y="30">each mark: a later request that reads those ' + num(T) + ' tokens again</text>')
      parts.push('<text class="svg-t strong" x="' + (W - 8) + '" y="102" text-anchor="end">' + L + ' later requests</text>')
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
      svg.style.height = H + 'px'
      svg.innerHTML = parts.join('')
    }
    wire(root, render)
    render()
    onResize(svg.parentNode, render)
  }

  // ——————————————————————————————————————— statusline (its line.ts, ported)

  function statusline(root) {
    var AUTO = 800e3
    var SEP = '   '
    var EFFORT = { low: 'faint', medium: 'label', high: 'text', xhigh: 'accent', max: 'accent' }
    var severity = function (f) {
      return f >= 0.95 ? 'alert' : f >= 0.8 ? 'warn' : 'accent'
    }
    var width = function (s) {
      return Array.from(s).length
    }
    var segW = function (s) {
      return s.parts.reduce(function (a, p) {
        return a + width(p.text)
      }, 0)
    }
    function gauge(frac, cells, tone) {
      var halves = Math.round(Math.min(1, Math.max(0, frac)) * cells * 2)
      var out = []
      for (var i = 0; i < cells; i++) {
        var filled = Math.min(2, Math.max(0, halves - i * 2))
        var glyph = filled === 2 ? '━' : filled === 1 ? '╸' : '─'
        var t = filled > 0 ? tone : 'faint'
        var last = out[out.length - 1]
        if (last && last.tone === t) last.text += glyph
        else out.push({ text: glyph, tone: t })
      }
      return out
    }
    function fit(segs, room) {
      var kept = segs.slice()
      var total = function () {
        return kept.reduce(function (a, s) { return a + segW(s) }, 0) + Math.max(0, kept.length - 1) * SEP.length
      }
      var log = []
      while (kept.length && total() > room) {
        var worst = kept.reduce(function (a, b) { return b.priority >= a.priority ? b : a })
        var at = kept.indexOf(worst)
        if (worst.short) {
          kept[at] = { id: worst.id, name: worst.name, priority: worst.priority, parts: worst.short }
          log.push(worst.name + ' says its short form')
        } else {
          kept.splice(at, 1)
          log.push(worst.name + ' is dropped')
        }
      }
      return { kept: kept, log: log }
    }
    function render() {
      var cols = val(root, 'cols')
      var ctx = val(root, 'ctx') * 1000
      var h5 = val(root, 'h5')
      var d7 = val(root, 'd7')
      var effort = val(root, 'effort')
      var cache = val(root, 'cache')
      out(root, 'cols', cols + ' columns')
      out(root, 'ctx', tok(ctx) + ' tokens')
      out(root, 'h5', h5 + '%')
      out(root, 'd7', d7 + '%')
      var frac = ctx / AUTO
      var tone = severity(frac)
      var size = { text: tok(ctx) + ' ', tone: tone === 'accent' ? 'label' : tone }
      var segs = [
        { id: 'model', name: 'the model', priority: 5, parts: [{ text: 'Opus 5.5', tone: 'label' }, { text: ' ' + effort, tone: EFFORT[effort] }] },
        { id: 'context', name: 'the context gauge', priority: 1, parts: [size].concat(gauge(frac, cols >= 110 ? 12 : 8, tone)), short: [{ text: size.text.trim(), tone: size.tone }] },
      ]
      ;[['5h', h5, ' ↺2h14', 2, 'the 5-hour window'], ['7d', d7, ' ↺3d', 3, 'the 7-day window']].forEach(function (w) {
        var f = w[1] / 100
        var t = f >= 0.8 ? severity(f) : f >= 0.5 ? 'text' : 'label'
        var short = [{ text: w[0] + ' ', tone: 'label' }, { text: w[1] + '%', tone: t }]
        segs.push({ id: w[0], name: w[4], priority: w[3], parts: short.concat([{ text: w[2], tone: 'faint' }]), short: short })
      })
      var dot = [{ text: '●', tone: 'good' }, { text: ' ready', tone: 'label' }]
      var ready =
        cache === 'ready' ? { parts: dot.concat([{ text: ' · cold in 44m', tone: 'label' }]), short: dot }
        : cache === 'soon' ? { parts: dot.concat([{ text: ' · cold in 4:00', tone: 'warn' }]), short: dot }
        : cache === 'keep' ? { parts: [{ text: '◐', tone: 'accent' }, { text: ' keeping warm', tone: 'label' }] }
        : { parts: [{ text: '○', tone: 'warn' }, { text: ' cold', tone: 'warn' }] }
      segs.push({ id: 'ready', name: 'smart-compact’s segment', priority: 0, parts: ready.parts, short: ready.short })
      var hint = '⏵⏵ auto mode on'
      var room = cols - width(hint) - 3
      var r = fit(segs, room)
      var html = r.kept
        .map(function (s) {
          return s.parts.map(function (p) { return '<span class="t-' + p.tone + '">' + esc(p.text) + '</span>' }).join('')
        })
        .join(SEP)
      var line = $(root, '.term-line')
      line.style.width = cols + 'ch'
      $(root, '.sl-line').innerHTML = html
      $(root, '.sl-dropped').textContent = r.log.length ? 'At ' + cols + ' columns: ' + r.log.join(', ') + '.' : 'At ' + cols + ' columns everything fits.'
    }
    // On a narrow screen, start at the width the box can show, so the line is seen whole and already fitted.
    var term = $(root, '.term')
    var probe = document.createElement('span')
    probe.textContent = '0000000000'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    term.appendChild(probe)
    var fits = Math.floor((term.clientWidth - 32) / (probe.getBoundingClientRect().width / 10))
    term.removeChild(probe)
    var colsIn = $(root, '[data-in="cols"]')
    if (fits > 0 && fits < Number(colsIn.value)) colsIn.value = Math.max(Number(colsIn.min), fits)
    wire(root, render)
    render()
  }

  // ——————————————————————————————————————— smart-compact (its policy.ts and line.ts, ported)

  function smartcompact(root) {
    var AWAY = [2, 4, 8, 15, 30, 55, 70, 120, 180, 240, 360, 480]
    var LEARNED = { summaryTokens: 8000, postCompactTokens: 40000, compactCacheShare: 0.9 }
    var POLICY = { minSavingsUsd: 0.25, compactPenaltyUsd: 0.5, minCompactTokens: 100000, maxIdleMs: 6 * 3600e3 }
    var svg = $(root, '.sc-svg')
    function costsOf(ctx, ttlMs) {
      var w = ttlMs > 5 * 60e3 ? 2 : 1.25
      var after = Math.min(LEARNED.postCompactTokens, ctx)
      var share = LEARNED.compactCacheShare
      var compactRequest = ctx * ((share * P.read) / M + ((1 - share) * w * P.input) / M) + (LEARNED.summaryTokens * P.output) / M
      return { lapse: (ctx * w * P.input) / M, keepAlive: (ctx * P.read) / M + (300 * P.output) / M, compact: compactRequest + (after * w * P.input) / M }
    }
    function decide(strategy, ctx, ttlMs, kept, idleMs) {
      var c = costsOf(ctx, ttlMs)
      if (c.lapse < POLICY.minSavingsUsd) return { action: 'lapse', why: 're-caching costs only ' + usd(c.lapse), costs: c }
      var compactAll = c.compact + POLICY.compactPenaltyUsd
      var pays = strategy !== 'keepalive' && ctx >= POLICY.minCompactTokens && compactAll < c.lapse
      var affords = function (b) { return kept + c.keepAlive <= b }
      var budget = pays ? compactAll : c.lapse / 2
      if (idleMs < POLICY.maxIdleMs && affords(budget)) return { action: 'keepalive', costs: c }
      if (pays) return { action: 'compact', costs: c }
      return { action: 'lapse', why: 'keeping it warm no longer pays', costs: c }
    }
    function simulate(strategy, ctx, ttlMs, awayMs) {
      var margin = ttlMs > 5 * 60e3 ? 150e3 : 45e3
      var warmAt = 0
      var kept = 0
      var events = []
      var cost = 0
      var end = null
      for (var guard = 0; guard < 500; guard++) {
        var actAt = warmAt + ttlMs - margin
        if (actAt > awayMs) break
        var d = decide(strategy, ctx, ttlMs, kept, actAt)
        if (d.action === 'keepalive') {
          cost += d.costs.keepAlive
          kept += d.costs.keepAlive
          events.push({ t: actAt, a: 'keepalive', cost: d.costs.keepAlive })
          warmAt = actAt
          continue
        }
        if (d.action === 'compact') {
          cost += d.costs.compact
          events.push({ t: actAt, a: 'compact', cost: d.costs.compact })
          end = { kind: 'compacted', t: actAt }
          break
        }
        events.push({ t: warmAt + ttlMs, a: 'lapse', why: d.why })
        end = { kind: 'lapse', t: warmAt + ttlMs }
        break
      }
      var c = costsOf(ctx, ttlMs)
      if (end && end.kind === 'lapse' && awayMs >= end.t) cost += c.lapse
      return { events: events, cost: cost, end: end, warmAt: warmAt, costs: c, margin: margin }
    }
    function plainCost(ctx, ttlMs, awayMs) {
      return awayMs >= ttlMs ? costsOf(ctx, ttlMs).lapse : 0
    }
    function clockText(ms) {
      var s = Math.max(0, Math.round(ms / 1000))
      if (s < 600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
      var m = Math.round(s / 60)
      if (m < 60) return m + 'm'
      var h = Math.floor(m / 60)
      return m % 60 === 0 ? h + 'h' : h + 'h' + String(m % 60).padStart(2, '0')
    }
    function minutes(ms) {
      var m = Math.round(ms / 60e3)
      return m < 60 ? m + ' min' : (m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m / 60 + ' h')
    }
    function render() {
      var ctx = CTX[val(root, 'ctx')]
      var ttlMs = val(root, 'ttl') === '5m' ? 5 * 60e3 : 3600e3
      var away = AWAY[val(root, 'away')] * 60e3
      out(root, 'ctx', tok(ctx) + ' tokens')
      out(root, 'away', minutes(away))
      var smart = simulate('smart', ctx, ttlMs, away)
      var keep = simulate('keepalive', ctx, ttlMs, away)
      var plain = plainCost(ctx, ttlMs, away)
      var c = smart.costs
      var first = smart.events[0] ? smart.events[0].a : null
      $(root, '.sc-options').innerHTML =
        '<div class="sc-opt' + (first === 'lapse' ? ' best' : '') + '"><b>' + usd(c.lapse) + '</b><span>let it expire: the next prompt writes it all again</span></div>' +
        '<div class="sc-opt' + (first === 'keepalive' ? ' best' : '') + '"><b>' + usd(c.keepAlive) + '</b><span>one keep-alive: a cache read resets the clock</span></div>' +
        '<div class="sc-opt' + (first === 'compact' ? ' best' : '') + '"><b>~' + usd(c.compact) + '</b><span>compact while warm, plus detail lost to the summary</span></div>'

      var kas = smart.events.filter(function (e) { return e.a === 'keepalive' })
      var comp = smart.events.find(function (e) { return e.a === 'compact' })
      var lapse = smart.events.find(function (e) { return e.a === 'lapse' })
      var told = []
      if (!smart.events.length) told.push('you are back before it has to act: the cache is still warm, nothing spent')
      if (kas.length) told.push('kept it warm ' + kas.length + ' time' + (kas.length > 1 ? 's' : '') + ' (' + usd(kas.length * c.keepAlive) + ')')
      if (comp) told.push('then compacted it while warm (' + usd(comp.cost) + ')')
      if (lapse) told.push(lapse.why ? 'let it expire: ' + lapse.why : 'let it expire')
      $(root, '.w-out').innerHTML =
        'Away ' + minutes(away) + ', ' + tok(ctx) + ' tokens, ' + (ttlMs > 300e3 ? 'one-hour' : 'five-minute') + ' cache: smart-compact ' + told.join(', ') + '. ' +
        'In all <b>' + usd(smart.cost) + '</b>, against <b>' + usd(plain) + '</b> without the mod' + (keep.cost !== smart.cost ? ' and <b>' + usd(keep.cost) + '</b> with keep-alives only' : '') + '.'

      // The timeline.
      var W = width(svg.parentNode) - 24
      var H = 130
      var pad = { l: 8, r: 8 }
      var x = function (t) { return pad.l + (W - pad.l - pad.r) * Math.min(1, t / away) }
      var parts = []
      var warmEnd = smart.end ? smart.end.t : away
      parts.push('<rect class="ev-band-warm" x="' + x(0) + '" y="40" width="' + Math.max(0, x(Math.min(warmEnd, away)) - x(0)) + '" height="34" rx="6"/>')
      if (smart.end && smart.end.kind === 'lapse' && smart.end.t < away) parts.push('<rect class="ev-band-cold" x="' + x(smart.end.t) + '" y="40" width="' + (x(away) - x(smart.end.t)) + '" height="34" rx="6"/>')
      if (smart.end && smart.end.kind === 'compacted' && smart.end.t < away) parts.push('<rect class="ev-band-warm" x="' + x(smart.end.t) + '" y="48" width="' + (x(away) - x(smart.end.t)) + '" height="18" rx="6" opacity="0.6"/>')
      smart.events.forEach(function (e, i) {
        var cx = x(e.t)
        if (e.a === 'keepalive') parts.push('<circle class="ev-keep" cx="' + cx + '" cy="57" r="5"/>')
        if (e.a === 'compact') parts.push('<rect class="ev-compact" x="' + (cx - 6) + '" y="51" width="12" height="12" transform="rotate(45 ' + cx + ' 57)"/>')
        if (e.a === 'lapse') parts.push('<path d="M' + (cx - 5) + ' 52l10 10M' + (cx + 5) + ' 52l-10 10" stroke="var(--bad)" stroke-width="2"/>')
      })
      var label = function (t, text, anchor) {
        parts.push('<text class="svg-t" x="' + x(t) + '" y="96" text-anchor="' + (anchor || 'middle') + '">' + esc(text) + '</text>')
      }
      label(0, 'you step away', 'start')
      label(away, 'you are back', 'end')
      if (kas.length) parts.push('<text class="svg-t" x="' + x(kas[0].t) + '" y="28" text-anchor="' + (x(kas[0].t) > W - 140 ? 'end' : 'start') + '"><tspan class="ev-keep">●</tspan> keep-alive ' + usd(c.keepAlive) + (kas.length > 1 ? ' × ' + kas.length : '') + '</text>')
      if (comp) parts.push('<text class="svg-t" x="' + x(comp.t) + '" y="122" text-anchor="' + (x(comp.t) > W - 160 ? 'end' : 'middle') + '"><tspan class="ev-compact">◆</tspan> compacted ' + usd(comp.cost) + '</text>')
      if (lapse && lapse.t <= away) parts.push('<text class="svg-t" x="' + x(lapse.t) + '" y="122" text-anchor="' + (x(lapse.t) > W - 160 ? 'end' : 'middle') + '"><tspan class="ev-lapse">×</tspan> cold: ' + usd(c.lapse) + ' on return</text>')
      var at = (val(root, 'at') / 1000) * away
      parts.push('<line class="ev-now" x1="' + x(at) + '" x2="' + x(at) + '" y1="34" y2="80"/>')
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
      svg.innerHTML = parts.join('')

      // What the line says at the scrubbed moment (smart-compact's readySegment).
      out(root, 'at', minutes(at) + ' after you stepped away')
      var seg
      var next = smart.events.find(function (e) { return e.t > at })
      if (comp && at >= comp.t) seg = '<span class="t-accent">◌</span><span class="t-label"> compacted</span>'
      else if (smart.end && smart.end.kind === 'lapse' && at >= smart.end.t) seg = '<span class="t-warn">○ cold</span>'
      else {
        var warmSince = 0
        smart.events.forEach(function (e) { if (e.a === 'keepalive' && e.t <= at) warmSince = e.t })
        var edge = warmSince + ttlMs
        var plan = next ? next.a : 'none'
        var dot = '<span class="t-good">●</span><span class="t-label"> ready</span>'
        if (plan === 'compact' && next.t - at < 10 * 60e3) seg = dot + '<span class="t-label"> · compacts in ' + clockText(next.t - at) + '</span>'
        else if (plan !== 'keepalive' && plan !== 'compact') seg = dot + '<span class="' + (edge - at < 5 * 60e3 ? 't-warn' : 't-label') + '"> · cold in ' + clockText(edge - at) + '</span>'
        else seg = dot
      }
      $(root, '.sc-seg').innerHTML = seg
    }
    wire(root, render)
    render()
    onResize(svg.parentNode, render)
  }

  // ——————————————————————————————————————— delegate: a hand-off, step by step, and the verdict (plan.ts, ported)

  function delegate(root) {
    var STEPS = [
      ['Hand off', 'Claude calls hand_off with a task that stands alone, its kind (read, mechanical, build), the places it touches and a check command. The kind picks the worker: Haiku at low effort for read and mechanical work, Sonnet at medium for build work.',
        'hand_off({\n  kind: "build",\n  task: "Add click.Duration … (the approved plan, as the spec)",\n  focus: ["src/click/types.py#ParamType"],\n  check: "PYTHONPATH=src python -m pytest -q"\n})'],
      ['Where it reaches', 'For each place in focus, delegate asks the language server for its references and callers (with lsp-plus, the docs that mention it come along) and tells the worker.', null],
      ['The worker builds', 'A subagent with its own small context and the Edit and Write tools. The call waits for it inside the tool call: one request of the main model, however many the worker takes. The worker ends its report with a VERIFY block.',
        'VERIFY\ntests: PYTHONPATH=src python -m pytest -q tests/test_duration.py\nopen: none'],
      ['The evidence', 'The diff against a git snapshot taken at the start, however the worker edited; the check command, run by delegate itself; the VERIFY command run beside it, its tests counted (no test selected is no pass); what the work cost against the same steps on the main model.', null],
      ['The verdict', 'The result starts with one line. On Verified, Claude reports without running anything again. Try the cases below.', 'verdict'],
    ]
    var at = 0
    var list = $(root, '.dg-steps')
    var panel = $(root, '.dg-panel')
    var state = { check: 'pass', tests: 'pass', open: 'none', block: 'yes' }
    list.innerHTML = STEPS.map(function (s, i) {
      return '<li><button type="button" data-i="' + i + '">' + esc(s[0]) + '</button></li>'
    }).join('')
    function verdict() {
      var bad = []
      var good = []
      if (state.check === 'fail') bad.push('the check failed with exit 1')
      else good.push('the check passed (2020 passed)')
      if (state.tests === 'pass') good.push('the new tests passed on their own (27 passed)')
      else if (state.tests === 'none') bad.push('the new tests did not run (0 selected)')
      else bad.push('the new tests had 2 failing')
      if (state.block === 'no') bad.push("the worker's report had no VERIFY block")
      if (state.open !== 'none') bad.push('the worker left open: the example contradicts the rule about week 53')
      if (!bad.length) return { ok: true, line: 'Verified: ' + good.join('; ') + '; nothing left open. If the diff is what you asked for, report to the person now: nothing is left to run.' }
      return { ok: false, line: 'Not verified: ' + bad.join('; ') + '. Look at these before you report.' }
    }
    var radio = function (key, label, opts) {
      return '<fieldset class="ctl seg"><legend class="ctl-l">' + label + '</legend><div class="seg-row">' + opts.map(function (o) {
        return '<label><input type="radio" name="dg-' + key + '" data-k="' + key + '" value="' + o[0] + '"' + (state[key] === o[0] ? ' checked' : '') + '><span>' + o[1] + '</span></label>'
      }).join('') + '</div></fieldset>'
    }
    function render() {
      $$(list, 'button').forEach(function (b, i) {
        if (i === at) b.setAttribute('aria-current', 'step')
        else b.removeAttribute('aria-current')
        b.classList.toggle('done', i < at)
      })
      $(root, '.dg-count').textContent = 'Step ' + (at + 1) + ' of ' + STEPS.length
      $(root, '[data-act="prev"]').disabled = at === 0
      $(root, '[data-act="next"]').disabled = at === STEPS.length - 1
      var s = STEPS[at]
      var extra = ''
      if (s[2] === 'verdict') {
        var v = verdict()
        extra = '<div class="w-controls">' + radio('check', 'The check', [['pass', 'passes'], ['fail', 'fails']]) + radio('tests', 'The new tests', [['pass', 'pass'], ['none', 'did not run'], ['fail', 'fail']]) + radio('open', 'Left open', [['none', 'nothing'], ['week', 'a question']]) + radio('block', 'VERIFY block', [['yes', 'given'], ['no', 'missing']]) + '</div>' +
          '<p class="verdict' + (v.ok ? '' : ' not') + '">' + esc(v.line) + '</p>'
      } else if (s[2]) extra = '<pre class="verdict" style="border-left-color:var(--pack)">' + esc(s[2]) + '</pre>'
      panel.innerHTML = '<h4>' + esc(s[0]) + '</h4><p>' + esc(s[1]) + '</p>' + extra
      $$(panel, 'input[data-k]').forEach(function (r) {
        r.addEventListener('change', function () {
          state[r.getAttribute('data-k')] = r.value
          var keep = r.getAttribute('data-k') + r.value
          render()
          var again = $(panel, 'input[data-k="' + keep.replace(r.value, '') + '"][value="' + r.value + '"]')
          if (again) again.focus()
        })
      })
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]')
      if (!b) return
      at = Number(b.getAttribute('data-i'))
      render()
    })
    $(root, '[data-act="prev"]').addEventListener('click', function () { at = Math.max(0, at - 1); render() })
    $(root, '[data-act="next"]').addEventListener('click', function () { at = Math.min(STEPS.length - 1, at + 1); render() })
    render()
  }

  // ——————————————————————————————————————— Claude's own requests around a hand-off (lab notes 10)

  function requests(root) {
    function render() {
      var after = val(root, 'mode') === 'after'
      var chips = after
        ? ['<span class="rq hand">hand_off</span>', '<span class="rq">the answer</span>', '<span class="rq-total">2 requests</span>']
        : ['<span class="rq">looking around</span>', '<span class="rq part">looking around (0.6)</span>', '<span class="rq hand">hand_off</span>', '<span class="rq">checking the evidence</span>', '<span class="rq part">checking (0.5)</span>', '<span class="rq">the answer</span>', '<span class="rq-total">1.6 + 1 + 2.5 requests</span>']
      $(root, '.rq-row').innerHTML = chips.join('')
    }
    wire(root, render)
    render()
  }

  // ——————————————————————————————————————— lsp-plus: grep against the language server's answer

  function lsp(root) {
    var GREP = [
      ['import', 'src/click/exceptions.py:9:from .globals import resolve_color_default'],
      ['call', 'src/click/exceptions.py:48:        self.show_color = resolve_color_default()'],
      ['def', 'src/click/globals.py:54:def resolve_color_default(color: bool | None = None) -> bool | None:'],
      ['import', 'src/click/termui.py:20:from .globals import resolve_color_default'],
      ['call', 'src/click/termui.py:99:    if _compat.should_strip_ansi(stream, resolve_color_default()):'],
      ['call', 'src/click/termui.py:362:    color = resolve_color_default(color)'],
      ['call', 'src/click/termui.py:581:    color = resolve_color_default(color)'],
      ['import', 'src/click/utils.py:22:from .globals import resolve_color_default'],
      ['call', 'src/click/utils.py:342:    elif should_strip_ansi(file, resolve_color_default(color)):'],
    ]
    var ANSWER = [
      '`resolve_color_default` per the language server: called from 5 functions in 3 files (code only: strings, comments, docs and namesakes are in the grep above):',
      'src/click/exceptions.py: ClickException.__init__ (48)',
      'src/click/termui.py: _readline_prompt (99), get_pager_file (362), progressbar (581)',
      'src/click/utils.py: echo (342)',
    ]
    function render() {
      var withLsp = val(root, 'mode') === 'lsp'
      var lines = ['<span class="t-label">$ git grep -n resolve_color_default</span>']
      GREP.forEach(function (g) {
        lines.push('<span class="t-' + g[0] + '">' + esc(g[1]) + '</span>')
      })
      if (withLsp) {
        lines.push('')
        ANSWER.forEach(function (a, i) {
          lines.push('<span class="' + (i ? 't-text' : 't-good') + '">' + esc(a) + '</span>')
        })
      }
      $(root, '.lsp-out').innerHTML = lines.join('\n')
      $(root, '.w-out').innerHTML = withLsp
        ? 'The answer rides on the grep Claude already ran: <b>who calls it</b>, each caller named by its function, no further step. Measured on a rename: 4.6 → 3.4 requests.'
        : 'Nine lines: three imports, the definition, five calls. Which <b>function</b> each call sits in, the grep does not say: Claude reads on to find out.'
    }
    wire(root, render)
    render()
  }

  // ——————————————————————————————————————— cells: a step each, or one cell

  function cells(root) {
    var box = $(root, '.cl-flow')
    function note(kind, C) {
      var cost = tok(C) + ' tokens, ≈' + usd((C * P.read) / M)
      if (kind === 'edit') return 'cells: a second request in a row that made one edit; it re-read the whole context (' + cost + ', … s). Edits you already know can go together in one response, or into one run_cell with their check.'
      return 'cells: this check ran in a model request of its own right after the edits, and that request re-read the whole context (' + cost + ', … s). Next time send the check in the same response as the edits: calls in one response run in order, so it sees them. Or make the edits and the check one run_cell that returns only what failed.'
    }
    function render() {
      var C = CTX[val(root, 'ctx')]
      out(root, 'ctx', tok(C) + ' tokens')
      var one = val(root, 'mode') === 'cell'
      var anim = !still.matches ? ' anim' : ''
      var req = function (i, label, code, n, cls) {
        return '<div class="cl-req' + (cls || '') + anim + '" style="animation-delay:' + i * 90 + 'ms"><span class="cl-n"><b>Request ' + (i + 1) + '</b>' + label + '</span><div><pre>' + esc(code) + '</pre>' + (n ? '<span class="note">' + esc(n) + '</span>' : '') + '</div></div>'
      }
      if (one) {
        box.innerHTML = req(0, 'run_cell', "await read('src/app.py')\nawait edit('src/app.py', 'retries = 3', 'retries = 5')\nawait edit('src/app.py', 'timeout = 10', 'timeout = 30')\nconst t = await sh('python -m pytest -x -q tests/test_app.py 2>&1')\nreturn t.ok ? 'tests pass' : fold(t.out)", null, ' cell')
      } else {
        box.innerHTML =
          req(0, 'Read', 'Read src/app.py') +
          req(1, 'Edit', "Edit src/app.py: 'retries = 3' → 'retries = 5'") +
          req(2, 'Edit', "Edit src/app.py: 'timeout = 10' → 'timeout = 30'", note('edit', C)) +
          req(3, 'Bash', 'python -m pytest -x -q tests/test_app.py', note('check', C))
      }
      var each = (C * P.read) / M
      $(root, '.w-out').innerHTML = one
        ? 'One request instead of four: three fewer re-reads of ' + tok(C) + ' tokens, about <b>' + usd(3 * each) + '</b> saved here. Each edit still shows as a diff, and /rewind undoes it.'
        : 'Four requests, each re-reading ' + tok(C) + ' tokens: <b>' + usd(4 * each) + '</b> before any work. cells’ notes say so in the tool’s result, at most four of a kind; nothing is blocked.'
    }
    wire(root, render)
    render()
  }

  // ——————————————————————————————————————— eta: a job's row above the prompt (table.ts and estimate.ts, ported)

  function eta(root) {
    var band = $(root, '.eta-band')
    var call = $(root, '.eta-call')
    var SPIN = ['◐', '◓', '◑', '◒']
    var timer = null
    var TOTAL = 50
    var JOB_MS = 6 * 60e3 // the simulated job's length
    var REAL_MS = 7000 // how long the demo takes
    function hhmm(ms) {
      var d = new Date(ms)
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    }
    function dur(ms) {
      var m = Math.max(1, Math.round(ms / 60e3))
      return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0')
    }
    function gauge(frac, cells) {
      var halves = Math.round(Math.min(1, Math.max(0, frac || 0)) * cells * 2)
      var on = ''
      var off = ''
      for (var i = 0; i < cells; i++) {
        var f = Math.min(2, Math.max(0, halves - i * 2))
        if (f === 2) on += '━'
        else if (f === 1) on += '╸'
        else off += '─'
      }
      return '<span class="t-accent">' + on + '</span><span class="t-faint">' + off + '</span>'
    }
    function row(parts) {
      return parts.filter(Boolean).join('  ')
    }
    function draw(s) {
      var name = '<span class="t-text">stress tests</span>'
      if (s.state === 'idle') band.innerHTML = '<span class="t-faint">(no jobs)</span>'
      else if (s.state === 'running') {
        var spin = '<span class="t-accent">' + SPIN[Math.floor(s.real / 250) % 4] + '</span>'
        if (s.basis === 'measured') band.innerHTML = row([spin, name, gauge(s.frac, 12), '<span class="t-text">' + String(Math.floor(s.frac * 100)).padStart(3) + '%</span>', '<span class="t-label">' + s.done + '/' + TOTAL + '</span>', s.at ? '<span class="t-label">' + hhmm(s.at) + '</span>' : '', s.at ? '<span class="t-label">in ' + dur(s.at - s.now) + '</span>' : '<span class="t-faint">measuring</span>'])
        else band.innerHTML = row([spin, name, gauge(0, 12), '<span class="t-label">~' + hhmm(s.at) + '</span>', '<span class="t-label">in ~' + dur(Math.max(0, s.at - s.now)) + '</span>', "<span class=\"t-faint\">Claude's guess</span>"])
      } else if (s.state === 'beat') band.innerHTML = row(['<span class="t-good">✓</span>', name, '<span class="t-good">' + '━'.repeat(12) + '</span>', '<span class="t-text">100%</span>', s.basis === 'measured' ? '<span class="t-label">' + TOTAL + '/' + TOTAL + '</span>' : ''])
      else if (s.state === 'done') band.innerHTML = '<span class="t-faint">(the finished job has left the band)</span>'
      else if (s.state === 'failed') band.innerHTML = row(['<span class="t-bad">✕</span>', name, '<span class="t-bad">failed ' + hhmm(s.now) + '</span>', '<span class="t-label">after ' + dur(s.now - s.start) + '</span>', '<span class="t-faint">stays until you write again</span>'])
    }
    function callText() {
      return val(root, 'basis') === 'measured'
        ? 'track_progress({ task: "b7x2", done_pattern: "^tests/stress/\\\\S+ (PASSED|FAILED)", total: 50 })'
        : 'track_progress({ task: "b7x2", expected_minutes: 6 })'
    }
    function play() {
      if (timer) clearInterval(timer)
      var basis = val(root, 'basis')
      var fails = val(root, 'end') === 'fail'
      var t0 = Date.now()
      var start = Date.now()
      call.textContent = callText()
      var tick = function () {
        var real = Date.now() - t0
        var frac = Math.min(1, real / REAL_MS)
        var now = start + frac * JOB_MS
        if (fails && frac >= 0.72) {
          clearInterval(timer)
          timer = null
          draw({ state: 'failed', now: now, start: start })
          return
        }
        if (frac >= 1) {
          clearInterval(timer)
          timer = null
          draw({ state: 'beat', basis: basis })
          setTimeout(function () { if (!timer) draw({ state: 'done' }) }, 1200)
          return
        }
        if (basis === 'measured') {
          var done = Math.floor(frac * TOTAL)
          var f = done / TOTAL
          var at = done > 2 ? start + ((now - start) / f) : null
          draw({ state: 'running', basis: basis, frac: f, done: done, at: at, now: now, real: real })
        } else draw({ state: 'running', basis: basis, at: start + 6 * 60e3, now: now, real: real })
      }
      if (still.matches) {
        // No motion: the row at two thirds of the way, then its end on the next click.
        t0 = Date.now() - REAL_MS * 0.66
        tick()
        return
      }
      timer = setInterval(tick, 100)
      tick()
    }
    $(root, '[data-act="play"]').addEventListener('click', play)
    wire(root, function () {
      call.textContent = callText()
    })
    call.textContent = callText()
    draw({ state: 'idle' })
  }

  // ——————————————————————————————————————— route: the classifier's answers and route's rules

  function route(root) {
    var d = data(root)
    var list = $(root, '.rt-list')
    var detail = $(root, '.rt-detail')
    var sel = 0
    var HAND = { feature: 1, tests: 1 }
    function order(label) {
      var what = label === 'tests' ? 'test work' : 'feature work'
      return 'This prompt is ' + what + ", and the person's setting for " + what + ' is: implement it through the hand_off tool (kind build). Hand it off before you read the code: the worker reads it, so write the task from the request as given. Write the request into the task so it stands alone, with the project’s whole test suite as the check. The tool checks the worker’s work itself; when its result says Verified and the diff is what was asked, report to the person without running anything again.'
    }
    function decision(p, cls, min) {
      var c = p.calls[cls][0]
      if (p.text.length < 40) return { sent: false, go: false, c: c }
      return { sent: true, go: !!HAND[c.label] && c.score >= min, c: c }
    }
    function render() {
      var cls = val(root, 'cls')
      var min = val(root, 'min') / 100
      out(root, 'min', min.toFixed(2))
      list.innerHTML = d.prompts.map(function (p, i) {
        var r = decision(p, cls, min)
        var badge = !r.sent ? '<span class="rt-badge">not sent</span>' : r.go ? '<span class="rt-badge go">order</span>' : '<span class="rt-badge">' + esc(r.c.label) + '</span>'
        return '<button type="button" class="rt-item" role="option" aria-selected="' + (i === sel) + '" data-i="' + i + '"><span class="rt-t">' + (p.name ? esc(p.name) + ' <small>(bench)</small>' : '“' + esc(p.text) + '”') + '</span>' + badge + '</button>'
      }).join('')
      var p = d.prompts[sel]
      var r = decision(p, cls, min)
      var both = p.calls[cls].map(function (c) { return c.label + ' ' + c.score.toFixed(2) + ', ' + c.ms + ' ms' }).join(' · ')
      var other = cls === 'jev' ? 'scaledown' : 'jev'
      var o = p.calls[other][0]
      detail.innerHTML =
        '<pre class="rt-prompt">' + esc(p.text) + '</pre>' +
        '<div class="rt-facts"><div><b>' + esc(r.c.label) + '</b><span>label</span></div><div><b>' + r.c.score.toFixed(2) + '</b><span>score</span></div><div><b>' + r.c.ms + ' ms</b><span>answer time</span></div></div>' +
        '<p class="w-src">Both rounds: ' + esc(both) + '. ' + (cls === 'jev' ? 'ScaleDown' : 'Jev') + ' said ' + esc(o.label) + ' (' + o.score.toFixed(2) + '). Right labels for this prompt: ' + esc(p.accept.join(' or ')) + '.</p>' +
        (!r.sent
          ? '<p class="rt-none">Under 40 characters: a reply, not new work. route sends nothing, and the prompt goes to Claude as it is.</p>'
          : r.go
            ? '<p class="rt-order"><b>The order beside the prompt:</b> ' + esc(order(r.c.label)) + '</p>'
            : '<p class="rt-none">' + (HAND[r.c.label] ? 'Feature or test work, but the score is under ' + min.toFixed(2) + ': no order.' : 'Not feature or test work: no order, the work stays with Claude.') + '</p>')
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest('.rt-item')
      if (!b) return
      sel = Number(b.getAttribute('data-i'))
      render()
      var again = $(list, '.rt-item[data-i="' + sel + '"]')
      if (again) again.focus()
    })
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      sel = Math.max(0, Math.min(d.prompts.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)))
      render()
      var b = $(list, '.rt-item[data-i="' + sel + '"]')
      if (b) {
        b.focus()
        b.scrollIntoView({ block: 'nearest' })
      }
    })
    wire(root, render)
    render()
  }

  // ——————————————————————————————————————— seek: the order and its clock (economy.ts, ported)

  function seek(root) {
    var svg = $(root, '.sk-svg')
    function orderText(context) {
      var k = Math.round(context / 1000)
      return "The person's setting for looking around in this session (about " + k + 'k tokens of context so far): every response you make re-reads all of it, ' +
        'and whatever you read stays in it, re-read by every later response until it is compacted. So look around in few, lean steps: ' +
        'put the searches and reads you can already name into one command; when a search shows where to look, read those places in the same step; ' +
        'read only the definitions or lines you need (grep -n first, then a range around them), not whole files or long ranges; ' +
        'and do not read again what this session already holds unless it changed.'
    }
    // An example session: the context before each prompt, with one compaction.
    var SESSION = [30, 65, 110, 165, 205, 260, 330, 385, 430, 45, 95, 150, 215]
    function render() {
      var c = val(root, 'ctx') * 1000
      out(root, 'ctx', tok(c) + ' tokens')
      $(root, '.sk-order').textContent = orderText(c)
      var last
      var marks = SESSION.map(function (k) {
        var ctx = k * 1000
        var due = last === undefined || ctx < last / 2 || ctx >= last + 150e3
        if (due) last = ctx
        return due
      })
      var W = width(svg.parentNode) - 24
      var H = 190
      var pad = { l: 40, r: 10, t: 16, b: 34 }
      var n = SESSION.length
      var x = function (i) { return pad.l + ((W - pad.l - pad.r) * (i + 0.5)) / n }
      var y = function (k) { return pad.t + (H - pad.t - pad.b) * (1 - k / 450) }
      var parts = []
      ;[150, 300, 450].forEach(function (t) {
        parts.push('<line class="axis-l" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke-opacity="0.5"/><text class="axis-t" x="' + (pad.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + t + 'k</text>')
      })
      var bw = Math.min(26, ((W - pad.l - pad.r) / n) * 0.55)
      SESSION.forEach(function (k, i) {
        parts.push('<rect class="' + (marks[i] ? 'bar-added' : 'bar-base') + '" x="' + (x(i) - bw / 2) + '" y="' + y(k) + '" width="' + bw + '" height="' + (y(0) - y(k)) + '" rx="3" opacity="' + (marks[i] ? 1 : 0.55) + '"/>')
        if (marks[i]) parts.push('<text class="svg-t strong" x="' + x(i) + '" y="' + (y(k) - 6) + '" text-anchor="middle">order</text>')
      })
      var ci = SESSION.indexOf(45)
      parts.push('<line class="line-cut" x1="' + (x(ci) - ((W - pad.l - pad.r) / n) / 2) + '" x2="' + (x(ci) - ((W - pad.l - pad.r) / n) / 2) + '" y1="' + pad.t + '" y2="' + y(0) + '" stroke-dasharray="0"/><text class="axis-t" x="' + (x(ci) - ((W - pad.l - pad.r) / n) / 2 + 4) + '" y="' + (pad.t + 10) + '">compaction</text>')
      parts.push('<text class="axis-t" x="' + pad.l + '" y="' + (H - 10) + '">prompts of an example session, the context before each →</text>')
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
      svg.innerHTML = parts.join('')
    }
    wire(root, render)
    render()
    onResize(svg.parentNode, render)
  }

  // ——————————————————————————————————————— modpack: /mods and the hook guard

  function modpack(root) {
    var MODS = ['statusline', 'smart-compact', 'delegate', 'lsp-plus', 'cells', 'eta', 'seek', 'route']
    var on = {}
    MODS.forEach(function (m) { on[m] = m !== 'route' })
    var pane = $(root, '.mp-pane')
    var cmd = $(root, '.mp-cmd')
    function render(changed) {
      pane.innerHTML = MODS.map(function (m) {
        return '<button type="button" class="mp-mod" aria-pressed="' + on[m] + '" data-m="' + m + '">' + m + '<span class="sw-t" aria-hidden="true"></span></button>'
      }).join('')
      cmd.textContent = changed ? '> /mods ' + changed + ' ' + (on[changed] ? 'on' : 'off') + '\n  ' + changed + ' is ' + (on[changed] ? 'on' : 'off') + ', right away.' + (changed === 'route' && on.route ? ' It needs a classifier key: /route:setup.' : '') : '> /mods\n  ' + MODS.filter(function (m) { return on[m] }).length + ' of 8 on; route stays off until you turn it on.'
    }
    pane.addEventListener('click', function (e) {
      var b = e.target.closest('.mp-mod')
      if (!b) return
      var m = b.getAttribute('data-m')
      on[m] = !on[m]
      render(m)
      var again = $(pane, '[data-m="' + m + '"]')
      if (again) again.focus()
    })
    render()
    var running = null
    $(root, '[data-act="guard"]').addEventListener('click', function () {
      if (running) cancelAnimationFrame(running)
      var lanes = { off: $(root, '[data-lane="off"]'), on: $(root, '[data-lane="on"]') }
      var SIM = 75 // simulated seconds shown
      var t0 = performance.now()
      var speed = still.matches ? Infinity : 7 // simulated seconds per real second
      var step = function (now) {
        var s = Math.min(SIM, ((now - t0) / 1000) * speed)
        var offFrac = s / SIM
        lanes.off.querySelector('i').style.width = (offFrac * 100).toFixed(1) + '%'
        lanes.off.querySelector('.mp-t').textContent = s >= SIM ? 'still waiting after a minute' : 'waiting ' + Math.floor(s) + ' s'
        var onS = Math.min(s, 10)
        lanes.on.querySelector('i').style.width = ((onS / SIM) * 100).toFixed(1) + '%'
        lanes.on.querySelector('.mp-t').textContent = s >= 10 ? 'asked you after 10 s' : 'waiting ' + Math.floor(s) + ' s'
        if (s < SIM) running = requestAnimationFrame(step)
        else running = null
      }
      running = requestAnimationFrame(step)
    })
  }

  var WIDGETS = { rereader: rereader, steps: steps, carry: carry, statusline: statusline, smartcompact: smartcompact, delegate: delegate, requests: requests, lsp: lsp, cells: cells, eta: eta, route: route, seek: seek, modpack: modpack }

  function init() {
    $$(document, '.widget[data-widget]').forEach(function (el) {
      var fn = WIDGETS[el.getAttribute('data-widget')]
      if (fn) {
        try {
          fn(el)
        } catch (e) {
          if (window.console) console.error('widget ' + el.getAttribute('data-widget'), e)
        }
      }
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
