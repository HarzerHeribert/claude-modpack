/* The graveyard's tabs: one kind of failure at a time, or all. */
;(function () {
  'use strict'
  function init() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [data-kind]'))
    var graves = Array.prototype.slice.call(document.querySelectorAll('.graves .grave'))
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var kind = t.getAttribute('data-kind')
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', String(x === t)) })
        graves.forEach(function (g) { g.hidden = !!kind && g.getAttribute('data-kind') !== kind })
      })
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
