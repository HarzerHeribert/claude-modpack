/* The range strip, the one way this site draws a measured change, and only where numbers are read exactly (the
   evidence table, a mod's list of measurements); a legend sits beside it. An upright line at no change, the 95%
   range as a bar, the change as a dot, on one fixed scale (60% less to 60% more) wherever it appears, so two strips
   compare at a glance. A hollow dot's range includes no change; a diamond had no range in its source; an arrow runs
   off the scale. Counts ("8 of 8") get a proportion bar instead. The label a screen reader hears is the change in
   words (f.label, set by the build). The same code draws strips at build time and in the browser. */
;(function (root) {
  'use strict'
  var LO = -60
  var HI = 60
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  var MINUS = '−'
  var x = function (v, w) {
    return Math.round(((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * (w - 8) * 10) / 10 + 4
  }

  /** f: { shown, ci, effect, lo, hi, result } → an inline SVG, or '' when the claim is not a percentage. */
  function svg(f, opts) {
    opts = opts || {}
    var w = opts.w || 88
    var h = 14
    if (typeof f.effect !== 'number') return ratio(f.shown, w)
    var label = f.label || f.shown
    var parts = ['<line class="s-base" x1="4" x2="' + (w - 4) + '" y1="7" y2="7"/>', '<line class="s-zero" x1="' + x(0, w) + '" x2="' + x(0, w) + '" y1="2" y2="12"/>']
    var off = function (v) {
      return v < LO || v > HI
    }
    if (typeof f.lo === 'number' && typeof f.hi === 'number') {
      parts.push('<line class="s-ci" x1="' + x(f.lo, w) + '" x2="' + x(f.hi, w) + '" y1="7" y2="7"/>')
    }
    if (off(f.effect)) {
      var right = f.effect > HI
      var ax = right ? w - 1 : 1
      parts.push('<path class="s-arrow" d="M' + ax + ' 7 l' + (right ? -6 : 6) + ' -4 v8 z"/>')
    } else if (f.result === 'no-interval') {
      var cx = x(f.effect, w)
      parts.push('<rect class="s-mark" x="' + (cx - 3.2) + '" y="3.8" width="6.4" height="6.4" transform="rotate(45 ' + cx + ' 7)"/>')
    } else {
      parts.push('<circle class="s-mark' + (f.result === 'crosses' ? ' s-hollow' : '') + '" cx="' + x(f.effect, w) + '" cy="7" r="3.6"/>')
    }
    return '<svg class="strip s-' + esc(f.result) + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + parts.join('') + '</svg>'
  }

  /** "8 of 8", "0 of 45", "1 of 36 runs": a proportion bar; anything else: nothing. */
  function ratio(shown, w) {
    var m = /(\d+) of (\d+)/.exec(String(shown || ''))
    if (!m) return ''
    var k = Number(m[1])
    var n = Number(m[2])
    var fill = n ? Math.max(k ? 2 : 0, Math.round((k / n) * (w - 8))) : 0
    return '<svg class="strip s-ratio' + (k / n > 0.5 ? ' s-most' : '') + '" width="' + w + '" height="14" viewBox="0 0 ' + w + ' 14" role="img" aria-label="' + esc(k + ' of ' + n) + '"><rect class="s-track" x="4" y="4.5" width="' + (w - 8) + '" height="5" rx="2.5"/>' + (fill ? '<rect class="s-fill" x="4" y="4.5" width="' + fill + '" height="5" rx="2.5"/>' : '') + '</svg>'
  }

  /** The scale, for a table header: ticks at −50, −25, 0, +25, +50. */
  function axis(w) {
    w = w || 88
    var ticks = [-50, -25, 0, 25, 50]
    return '<svg class="strip-axis" width="' + w + '" height="14" viewBox="0 0 ' + w + ' 14" aria-hidden="true">' +
      ticks.map(function (t) {
        var tx = x(t, w)
        var label = t === 0 ? '0' : (t > 0 ? '+' : MINUS) + Math.abs(t)
        return (t % 50 === 0 ? '<text x="' + tx + '" y="10" text-anchor="middle">' + label + '</text>' : '<line x1="' + tx + '" x2="' + tx + '" y1="4" y2="10"/>')
      }).join('') + '</svg>'
  }

  root.Strip = { svg: svg, ratio: ratio, axis: axis, LO: LO, HI: HI }
})(typeof window !== 'undefined' ? window : globalThis)
