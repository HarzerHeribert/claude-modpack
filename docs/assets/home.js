// The front page's background: a slow mesh gradient in the pack's colours, drawn with WebGPU by the shaders package
// (assets/shaders.js, MIT, bundled with this site so nothing loads from elsewhere; its telemetry is off). Only where
// WebGPU works; with reduced motion asked for, it stands still. Until it draws, and wherever it can't, the CSS
// gradient under it stays. Light and dark have their own colours, redrawn when the theme changes.

;(() => {
  const hero = document.querySelector('.h-hero')
  const canvas = hero && hero.querySelector('.h-canvas')
  if (!canvas || !('gpu' in navigator)) return
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  const STOPS = {
    light: ['#fbf3ec', '#f2b8a0', '#d97757', '#b9a6f2', '#fbf3ec'],
    dark: ['#0d0a10', '#4a2418', '#b8583a', '#3b2d6e', '#0d0a10'],
  }
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme')
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  }
  let shader = null
  let drawing = Promise.resolve()
  const draw = () =>
    (drawing = drawing.then(async () => {
      const { createShader, isWebGPUSupported } = await import('./shaders.js')
      if (!isWebGPUSupported()) return
      const colors = STOPS[isDark() ? 'dark' : 'light']
      const stops = colors.map((color, i) => ({ color, position: i / (colors.length - 1) }))
      if (shader) shader.destroy()
      hero.classList.remove('is-live')
      shader = await createShader(
        canvas,
        {
          components: [
            { type: 'MeshGradient', id: 'mesh', props: { stops, count: 5, smoothness: 2, variation: 0.4, swirl: 0.35, drift: 0.4, speed: still.matches ? 0 : 0.35, seed: 3 } },
            { type: 'FilmGrain', id: 'grain', props: { strength: isDark() ? 0.035 : 0.16 } },
          ],
        },
        { disableTelemetry: true, onReady: () => hero.classList.add('is-live'), onError: () => hero.classList.remove('is-live') },
      )
    }).catch(() => hero.classList.remove('is-live')))
  draw()
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => document.documentElement.hasAttribute('data-theme') || draw())
})()
