/* The evidence table: filter, search and sort the claims, open a row for its quote, sources and raw runs; the
   filters and the sort are kept in the address, so a view can be linked (evidence.html?mod=cells&sort=effect). */
;(function () {
  'use strict'

  function init() {
    var form = document.querySelector('.toolbar')
    var table = document.getElementById('ev-table')
    if (!form || !table) return
    var body = table.tBodies[0]
    var rows = Array.prototype.slice.call(body.querySelectorAll('tr.ev-row')).map(function (tr, i) {
      var d = document.getElementById('d-' + tr.getAttribute('data-id'))
      var strip = tr.querySelector('.strip')
      var num = function (k) { var v = tr.getAttribute('data-' + k); return v === '' || v === null ? null : Number(v) }
      return {
        tr: tr,
        detail: d,
        order: i,
        id: tr.getAttribute('data-id'),
        mods: tr.getAttribute('data-mods').split(' '),
        claim: tr.querySelector('.claim').textContent,
        text: (tr.textContent + ' ' + (d ? d.textContent : '')).toLowerCase(),
        effect: num('effect'),
        width: num('width'),
        date: tr.getAttribute('data-date') || '',
        strip: strip,
      }
    })
    var byId = {}
    rows.forEach(function (r) { byId[r.id] = r })
    var count = document.getElementById('ev-n')
    var empty = document.querySelector('.ev-empty')
    var reset = form.querySelector('[type="reset"]')
    var KEYS = ['q', 'mod', 'session', 'language', 'metric', 'result']
    var sort = { key: '', dir: 1 }

    function get() {
      var s = {}
      KEYS.forEach(function (k) { s[k] = form.elements[k].value.trim() })
      return s
    }
    function matches(r, s) {
      var tr = r.tr
      if (s.mod && r.mods.indexOf(s.mod) < 0) return false
      if (s.session && tr.getAttribute('data-session') !== s.session) return false
      if (s.language && tr.getAttribute('data-language') !== s.language) return false
      if (s.metric && tr.getAttribute('data-metric') !== s.metric) return false
      if (s.result && tr.getAttribute('data-result') !== s.result) return false
      if (s.q) {
        var words = s.q.toLowerCase().split(/\s+/)
        for (var i = 0; i < words.length; i++) if (r.text.indexOf(words[i]) < 0) return false
      }
      return true
    }
    function compare(a, b) {
      var k = sort.key
      var d = sort.dir
      var nul = function (v) { return v === null || v === '' }
      if (!k) return a.order - b.order
      if (k === 'claim') return d * a.claim.localeCompare(b.claim) || a.order - b.order
      var va = a[k]
      var vb = b[k]
      if (nul(va) && nul(vb)) return a.order - b.order
      if (nul(va)) return 1
      if (nul(vb)) return -1
      if (k === 'date') return d * (va < vb ? -1 : va > vb ? 1 : 0) || a.order - b.order
      return d * (va - vb) || a.order - b.order
    }
    function apply(keepUrl) {
      var s = get()
      var shown = rows.filter(function (r) { return matches(r, s) })
      shown.sort(compare)
      var on = {}
      shown.forEach(function (r) { on[r.id] = true })
      rows.forEach(function (r) {
        r.tr.hidden = !on[r.id]
        if (r.detail && !on[r.id]) r.detail.hidden = true
      })
      shown.forEach(function (r) {
        body.appendChild(r.tr)
        if (r.detail) body.appendChild(r.detail)
        if (r.detail && r.tr.querySelector('.xb').getAttribute('aria-expanded') === 'true') r.detail.hidden = false
      })
      count.textContent = shown.length
      empty.hidden = shown.length > 0
      reset.hidden = !KEYS.some(function (k) { return s[k] }) && !sort.key
      table.querySelectorAll('th[aria-sort]').forEach(function (th) {
        var b = th.querySelector('[data-sort]')
        th.setAttribute('aria-sort', b && b.getAttribute('data-sort') === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none')
      })
      if (!keepUrl) {
        var q = new URLSearchParams()
        KEYS.forEach(function (k) { if (s[k]) q.set(k, s[k]) })
        if (sort.key) q.set('sort', (sort.dir < 0 ? '-' : '') + sort.key)
        history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash)
      }
    }

    var params = new URLSearchParams(location.search)
    KEYS.forEach(function (k) {
      var el = form.elements[k]
      if (!params.has(k)) return
      var v = params.get(k)
      if (el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o) { return o.value === v })) return
      el.value = v
    })
    if (params.get('sort')) {
      var sp = params.get('sort')
      sort = { key: sp.replace(/^-/, ''), dir: sp.charAt(0) === '-' ? -1 : 1 }
    }

    form.addEventListener('input', function () { apply() })
    form.addEventListener('change', function () { apply() })
    form.addEventListener('reset', function () {
      sort = { key: '', dir: 1 }
      setTimeout(function () { apply() }, 0)
    })
    document.querySelectorAll('[data-reset]').forEach(function (b) {
      b.addEventListener('click', function () { form.reset() })
    })
    table.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort')
        // First click: the natural order (effect: largest saving first; date: newest first); again: the other way.
        var first = k === 'date' ? -1 : 1
        sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: first }
        apply()
      })
    })
    function open(r, on) {
      var b = r.tr.querySelector('.xb')
      b.setAttribute('aria-expanded', String(on))
      if (r.detail) r.detail.hidden = !on
    }
    body.addEventListener('click', function (e) {
      var b = e.target.closest('.xb')
      if (!b) return
      var r = byId[b.closest('tr').getAttribute('data-id')]
      open(r, b.getAttribute('aria-expanded') !== 'true')
    })

    // A link to one claim opens it, whatever the filters said.
    function reveal() {
      if (!location.hash.startsWith('#f-')) return
      var r = byId[decodeURIComponent(location.hash.slice(3))]
      if (!r) return
      if (r.tr.hidden) {
        form.reset()
        sort = { key: '', dir: 1 }
        apply()
      }
      open(r, true)
      r.tr.classList.add('flash')
      r.tr.scrollIntoView({ block: 'center', behavior: 'auto' })
      setTimeout(function () { r.tr.classList.remove('flash') }, 2400)
    }
    window.addEventListener('hashchange', reveal)
    apply(true)
    if (location.hash) setTimeout(reveal, 30)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
