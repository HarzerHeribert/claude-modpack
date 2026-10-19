// The front page's backgrounds: mesh gradients in the pack's colours behind the hero and behind the numbers further
// down, drawn with WebGPU by the shaders package (assets/shaders.js, MIT, bundled with this site so nothing loads from
// elsewhere; its telemetry is off). The panes over them are clear glass, after kube.io's Liquid Glass: flat across the
// face, a little darker than what is below, bending it at a rounded bevel. Below the glass, fine contour lines flow
// slowly on their own, so the bending shows; with a mouse they rise in a soft hill where the cursor is, and over the hero
// the colours drift softly after it.
// How much moves is what the device keeps up with: full (lively, with the cursor) on a machine with a mouse, 8 cores
// and 8 GB; calm (slow) elsewhere; still (one frame) with reduced motion asked for. Frames that stay late, measured
// once the page has loaded, step it down, never up. Each paused while out of view. Until it draws, and wherever it
// can't, the CSS gradients and the CSS glass stay. ?motion=full|calm|still picks one.

;(() => {
  if (!('gpu' in navigator)) return
  const LEVELS = ['still', 'calm', 'full']
  const MOTION = {
    still: { swirl: 0.35, drift: 0.4, speed: 0 },
    calm: { swirl: 0.35, drift: 0.4, speed: 0.35 },
    full: { swirl: 0.45, drift: 0.6, speed: 0.8 },
  }
  const MESH = { count: 5, smoothness: 2, variation: 0.4 }
  // The proof section is dark in both themes.
  const SCENES = [
    {
      at: '.h-hero',
      panes: '.h-eyebrow, .install.big, .h-links .btn:not(.primary), .h-stats li',
      seed: 3,
      stops: {
        light: ['#fbf3ec', '#f2b8a0', '#d97757', '#b9a6f2', '#fbf3ec'],
        dark: ['#0d0a10', '#4a2418', '#b8583a', '#3b2d6e', '#0d0a10'],
      },
      grain: { light: 0.16, dark: 0.035 },
      hasFlow: true,
    },
    {
      at: '.h-proof',
      panes: '.h-nums li',
      seed: 8,
      theme: 'dark',
      stops: { dark: ['#0c0a0f', '#2a150f', '#6e3322', '#2a2152', '#0c0a0f'] },
      grain: { dark: 0.035 },
    },
  ]
  // The colours that drift after the cursor, kept faint: a little of the gradient's own colours, not a trail.
  const FLOW = {
    light: { baseColor: '#b9a6f2', upColor: '#f2b8a0', downColor: '#d97757', leftColor: '#c9bbf5', rightColor: '#e8906f' },
    dark: { baseColor: '#3b2d6e', upColor: '#b8583a', downColor: '#5a44a8', leftColor: '#8a3f28', rightColor: '#6c58b8' },
    props: { intensity: 0.9, radius: 2.2, momentum: 22, opacity: 0.6 },
  }
  // The bevel's height runs as a squircle, steep at the edge and flat where it meets the face, and it bends what is below
  // as glass would (Snell's law, n = 1.5). Its width and thickness in pixels (a small pane gets a narrower one); how much
  // darker the glass is than what is below, how much more colourful it shows it, and how dark the lines below are (or,
  // below zero, how light). No highlight: it would only veil the bending.
  const BEVEL = 24
  const THICK = 44
  const GLASS = { light: { absorb: 0.06, vivid: 0.25, ink: 0.12 }, dark: { absorb: 0.2, vivid: 0.3, ink: -0.045 } }
  // Below the glass, contour lines of a slow field, as a gradient alone gives the bevel nothing to bend: their width in
  // pixels; how many to a rise of one in the field, how tightly it folds, how fast it flows at each level, and how high a
  // hill the cursor raises.
  const HAIR = 1
  const FIELD = { bands: 7, fold: 1.7, pace: { still: 0, calm: 0.05, full: 0.1 }, hill: 0.6 }
  const MAX_PANES = 8

  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme')
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  }
  const isPointer = matchMedia('(hover: hover) and (pointer: fine)').matches
  const asked = new URLSearchParams(location.search).get('motion')
  const hinted = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
    const isBig = (navigator.hardwareConcurrency || 4) >= 8 && (navigator.deviceMemory || 8) >= 8
    return isPointer && isBig ? 2 : 1
  }
  let level = LEVELS.includes(asked) ? LEVELS.indexOf(asked) : hinted()
  const isStill = () => LEVELS[level] === 'still'

  // The glass, for up to MAX_PANES panes in one pass. Each pane is a centre (0..1 of the canvas, from its top left), a
  // half width and half height (shares of the canvas's width and height) and a corner radius (a share of its height);
  // a pane with no width is not there. In the shader uv runs from the top left, as the page does.
  let isDefined = false
  const define = ({ defineShader, wgsl, registerShader, transformPosition }) => {
    if (isDefined) return
    isDefined = true
    const all = name => Array.from({ length: MAX_PANES }, (_, i) => name(i)).join(', ')
    const props = { bevel: { default: 0.02 }, thickness: { default: 0.03 }, absorb: { default: 0.1 }, vivid: { default: 0.2 }, ink: { default: 0.05 } }
    Object.assign(props, { bands: { default: FIELD.bands }, hair: { default: 0.001 }, pace: { default: 0 }, mx: { default: 0.5 }, my: { default: 0.5 }, hill: { default: 0 } })
    // The field the contour lines are drawn on, at p: sines bent by sines, in heights of the canvas, flowing slowly, with
    // a soft hill where the cursor is.
    const field = (name, p) => `
          let p${name} = (${p}) * viewport / unit * fold;
          let b${name} = vec2f(sin(p${name}.y * 2.1 + flow * 0.7), sin(p${name}.x * 1.7 - flow * 0.5));
          let f${name} = 0.5 * sin(p${name}.x * 2.3 + b${name}.x * 1.1 + flow) + 0.5 * sin(p${name}.y * 2.9 + b${name}.y * 1.3 - flow * 0.8) + 0.3 * sin((p${name}.x + p${name}.y) * 1.6 + flow * 0.6) + hill * exp(-dot(p${name} - mouse, p${name} - mouse) / 0.04);`
    for (let i = 0; i < MAX_PANES; i++)
      Object.assign(props, {
        [`c${i}`]: { default: { x: 0.5, y: 0.5 }, transform: transformPosition },
        [`w${i}`]: { default: 0 },
        [`h${i}`]: { default: 0 },
        [`r${i}`]: { default: 0 },
      })
    registerShader(
      defineShader({
        name: 'Panes',
        props,
        effect: wgsl(`
          let px = uv * viewport;
          let unit = viewport.y;
          let wide = max(bevel * unit, 1.0);
          let thick = thickness * unit;
          let aa = 0.75;
          var cs = array<vec2f, ${MAX_PANES}>(${all(i => `c${i}`)});
          var hs = array<vec2f, ${MAX_PANES}>(${all(i => `vec2f(w${i}, h${i})`)});
          var rs = array<f32, ${MAX_PANES}>(${all(i => `r${i}`)});
          var shift = vec2f(0.0);
          var face = 0.0;
          for (var i = 0; i < ${MAX_PANES}; i++) {
            let half = hs[i] * viewport;
            if (half.x <= 0.0) { continue; }
            let q = px - cs[i] * viewport;
            let r = min(rs[i] * viewport.y, min(half.x, half.y));
            let k = abs(q) - half + r;
            let d = length(max(k, vec2f(0.0))) + min(max(k.x, k.y), 0.0) - r;
            var n = vec2f(0.0, sign(q.y));
            if (k.x > 0.0 && k.y > 0.0) { n = normalize(k) * sign(q); } else if (k.x > k.y) { n = vec2f(sign(q.x), 0.0); }
            let w = min(wide, min(half.x, half.y) * 0.5);
            let t = thick * w / wide;
            let inside = 1.0 - smoothstep(-aa, aa, d);
            face = max(face, inside);
            // x runs across the bevel, 0 at the edge to 1 at the face; h is its height there, slope its steepness.
            let x = clamp(-d / w, 0.0, 1.0);
            let m = 1.0 - x;
            let rest = max(1.0 - m * m * m * m, 1e-4);
            let h = pow(rest, 0.25);
            let slope = m * m * m * pow(rest, -0.75) * t / w;
            let tilt = atan(slope);
            let bent = asin(sin(tilt) / 1.5);
            shift += n * t * h * tan(tilt - bent) * inside;
          }
          let at = uv - shift / viewport;
          let split = shift / viewport * 0.05;
          let cr = textureSampleLevel(childTexture, childSampler, at - split, 0.0);
          let cg = textureSampleLevel(childTexture, childSampler, at, 0.0);
          let cb = textureSampleLevel(childTexture, childSampler, at + split, 0.0);
          // The contour lines, traced where the glass looks so they bend with the rest, each colour at its own split; a line
          // keeps its width in pixels, and fades where they crowd.
          let flow = time * pace;
          let fold = ${FIELD.fold.toFixed(2)};
          let mouse = vec2f(mx, my) * viewport / unit * fold;${field('r', 'at - split')}${field('g', 'at')}${field('b', 'at + split')}
          let level = vec3f(fr, fg, fb) * bands;
          let fine = max(fwidth(level), vec3f(1e-4));
          let lines = clamp(hair * unit * 0.5 + 0.5 - abs(fract(level + 0.5) - 0.5) / fine, vec3f(0.0), vec3f(1.0)) * (1.0 - smoothstep(vec3f(0.2), vec3f(0.6), fine));
          let below = mix(vec3f(cr.r, cg.g, cb.b), vec3f(select(1.0, 0.0, ink > 0.0)), abs(ink) * lines);
          let grey = vec3f(dot(below, vec3f(0.2126, 0.7152, 0.0722)));
          return vec4f(mix(grey, below, 1.0 + vivid * face) * (1.0 - absorb * face), cg.a);
        `),
      }),
    )
  }

  const scenes = []
  const drawAll = () => scenes.forEach(s => s.draw())

  // Two seconds of frames, a second after the page has loaded: twice late in a row steps it down a level and draws
  // again. Images and fonts still arriving make a few frames late; a device that can't keep up makes most of them late.
  let watching = 0
  let strikes = 0
  const watch = () => {
    if (isStill()) return
    const run = ++watching
    let times = []
    let start = 0
    const step = now => {
      if (run !== watching || document.hidden || !scenes.some(s => s.isVisible())) return
      if (!start) start = now + 1000
      if (now >= start) times.push(now)
      if (times.length && now - times[0] >= 2000) {
        const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
        strikes = gaps[gaps.length >> 1] > 25 ? strikes + 1 : 0
        if (strikes >= 2) {
          strikes = 0
          level -= 1
          drawAll()
          return
        }
        if (!strikes) return
        times = []
      }
      requestAnimationFrame(step)
    }
    if (document.readyState === 'complete') requestAnimationFrame(step)
    else addEventListener('load', () => requestAnimationFrame(step), { once: true })
  }

  const mount = spec => {
    const section = document.querySelector(spec.at)
    const canvas = section && section.querySelector('.h-canvas')
    if (!canvas) return
    const theme = () => spec.theme || (isDark() ? 'dark' : 'light')
    const panes = () => [...section.querySelectorAll(spec.panes)].slice(0, MAX_PANES)
    const geometry = () => {
      const c = canvas.getBoundingClientRect()
      const props = { bevel: BEVEL / c.height, thickness: THICK / c.height, hair: HAIR / c.height }
      panes().forEach((el, i) => {
        const r = el.getBoundingClientRect()
        const round = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
        props[`c${i}`] = { x: (r.left + r.width / 2 - c.left) / c.width, y: (r.top + r.height / 2 - c.top) / c.height }
        props[`w${i}`] = r.width / 2 / c.width
        props[`h${i}`] = r.height / 2 / c.height
        props[`r${i}`] = round / c.height
      })
      return props
    }

    let shader = null
    let isVisible = false
    let drawing = Promise.resolve()
    const draw = () =>
      (drawing = drawing.then(async () => {
        const lib = await import('./shaders.js')
        if (!lib.isWebGPUSupported()) return
        define(lib)
        const t = theme()
        const name = LEVELS[level]
        const colors = spec.stops[t]
        const stops = colors.map((color, i) => ({ color, position: i / (colors.length - 1) }))
        const components = [{ type: 'MeshGradient', id: 'mesh', props: { stops, ...MESH, seed: spec.seed, ...MOTION[name] } }]
        if (spec.hasFlow && name === 'full' && isPointer) components.push({ type: 'ChromaFlow', id: 'flow', props: { ...FLOW[t], ...FLOW.props } })
        components.push({ type: 'Panes', id: 'glass', props: { ...GLASS[t], pace: FIELD.pace[name], ...geometry() } })
        // The grain goes over the glass: squeezed by the bevel, it would read as frost.
        components.push({ type: 'FilmGrain', id: 'grain', props: { strength: spec.grain[t] } })
        if (shader) shader.destroy()
        section.classList.remove('is-live')
        section.dataset.motion = name
        shader = await lib.createShader(canvas, { components }, {
          disableTelemetry: true,
          onReady: () => {
            section.classList.add('is-live')
            if (isStill() || !isVisible) requestAnimationFrame(() => shader && shader.pause())
            else watch()
          },
          onError: () => section.classList.remove('is-live'),
        })
      }).catch(() => section.classList.remove('is-live')))

    // The panes move with the layout: a resize, a font arriving, the numbers switching between words and digits.
    let isQueued = false
    const follow = () => {
      if (isQueued) return
      isQueued = true
      requestAnimationFrame(() => {
        isQueued = false
        if (!shader) return
        shader.resize()
        shader.update('glass', geometry())
        // A paused shader draws nothing new: one frame for the panes' new places.
        if (isStill() || !isVisible) {
          shader.resume()
          requestAnimationFrame(() => requestAnimationFrame(() => shader && shader.pause()))
        }
      })
    }
    const sizes = new ResizeObserver(follow)
    sizes.observe(section)
    panes().forEach(el => sizes.observe(el))

    // The hill eases after the cursor across the section, and away again when it leaves.
    const mouse = { x: 0.5, y: 0.5, hill: 0 }
    const aim = { ...mouse }
    let isEasing = false
    const ease = () => {
      for (const k in mouse) mouse[k] += (aim[k] - mouse[k]) * 0.04
      if (shader && !isStill()) shader.update('glass', { mx: mouse.x, my: mouse.y, hill: mouse.hill })
      isEasing = Object.keys(mouse).some(k => Math.abs(aim[k] - mouse[k]) > 0.001)
      if (isEasing) requestAnimationFrame(ease)
    }
    const chase = () => {
      if (isEasing || isStill()) return
      isEasing = true
      requestAnimationFrame(ease)
    }
    if (isPointer) {
      section.addEventListener('pointermove', e => {
        const r = canvas.getBoundingClientRect()
        Object.assign(aim, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, hill: FIELD.hill })
        chase()
      })
      section.addEventListener('pointerleave', () => {
        aim.hill = 0
        chase()
      })
    }

    new IntersectionObserver(([e]) => {
      isVisible = e.isIntersecting
      if (!shader || isStill()) return
      if (isVisible) {
        shader.resume()
        watch()
      } else shader.pause()
    }).observe(section)

    scenes.push({ draw, isVisible: () => isVisible })
    draw()
  }

  SCENES.forEach(mount)
  new MutationObserver(drawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => document.documentElement.hasAttribute('data-theme') || drawAll())
})()
