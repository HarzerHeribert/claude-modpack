// The front page's backgrounds, behind the hero and behind the numbers further down, drawn with WebGPU through the
// shaders package (assets/shaders.js, MIT, bundled with this site so nothing loads from elsewhere; its telemetry is off)
// as one effect of the site's own each: the pack's colours as a mesh after the package's MeshGradient, fine contour
// lines flowing slowly over them, and the panes as clear glass after kube.io's Liquid Glass, flat across the face, a
// little darker than what is below, bending it at a rounded bevel. With a mouse, the lines rise in a soft hill where the
// cursor is, and a colour point of its own follows it. Film grain over all of it, as the package's.
// How much moves is what the device keeps up with: full (lively, at up to 60 frames a second) on a machine with a
// mouse, 8 cores and 8 GB; calm (slow, at 30) elsewhere; still (one frame) with reduced motion asked for. Frames that
// stay late, measured once the page has loaded, halve the rate, then step it down a level, never up. Each paused while
// out of view. Until it draws, and wherever it can't, the CSS gradients and the CSS glass stay. ?motion=full|calm|still
// picks one.

;(() => {
  if (!('gpu' in navigator)) return
  const LEVELS = ['still', 'calm', 'full']
  // How fast the colours move, how far the plane swirls, and how far their points wander from home, at each level.
  const MOTION = {
    still: { swirl: 0.35, drift: 0.4, speed: 0 },
    calm: { swirl: 0.35, drift: 0.4, speed: 0.35 },
    full: { swirl: 0.45, drift: 0.6, speed: 0.8 },
  }
  // Frames a second at most at each level (the shaders' own gate, assets/shaders.js; a display may refresh faster).
  const RATE = { still: 30, calm: 30, full: 60 }
  // The proof section is dark in both themes. A scene's colours run through its stops; its seed scatters their points,
  // and the cursor's own point brings the colour that far along the stops.
  const SCENES = [
    {
      id: 'Hero',
      at: '.h-hero',
      panes: '.h-eyebrow, .install.big, .h-links .btn:not(.primary), .h-stats li',
      seed: 7,
      stops: {
        light: ['#fbf3ec', '#f2b8a0', '#d97757', '#b9a6f2', '#fbf3ec'],
        dark: ['#0d0a10', '#4a2418', '#b8583a', '#3b2d6e', '#0d0a10'],
      },
      grain: { light: 0.16, dark: 0.035 },
      reach: 0.5,
    },
    {
      id: 'Proof',
      at: '.h-proof',
      panes: '.h-nums li',
      seed: 8,
      theme: 'dark',
      stops: { dark: ['#0c0a0f', '#2a150f', '#6e3322', '#2a2152', '#0c0a0f'] },
      grain: { dark: 0.035 },
      reach: 0.5,
    },
  ]
  // How many colour points, and how heavy the cursor's point is beside one of them. Each weighs the inverse cube of its
  // distance, about as sharply as the package's smoothness of 2 (a power of 3.2) and cheaper.
  const MESH = { count: 5, pull: 0.7 }
  // The bevel's height runs as a squircle, steep at the edge and flat where it meets the face, and it bends what is below
  // as glass would (Snell's law, n = 1.5). Its width and thickness in pixels (a small pane gets a narrower one); how much
  // darker the glass is than what is below, how much more colourful it shows it, and how dark the lines below are (or,
  // below zero, how light). No highlight: it would only veil the bending.
  const BEVEL = 24
  const THICK = 44
  const GLASS = { light: { absorb: 0.06, vivid: 0.25, ink: 0.12 }, dark: { absorb: 0.2, vivid: 0.3, ink: -0.045 } }
  // Below the glass, contour lines of a slow field, as the colours alone give the bevel nothing to bend: their width in
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

  // A colour in Oklab (https://bottosson.github.io/posts/oklab/), where the shader blends.
  const oklab = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  // A scene's colour points, laid out as the package's are: on a golden spiral from the middle, jittered, each with a
  // phase and a pace for wandering and a share along the stops, all from the seed.
  const hash = x => {
    const s = Math.sin(x * 127.1 + 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const scatter = seed =>
    Array.from({ length: MESH.count }, (_, i) => {
      const theta = i * 2.39996323 + hash(seed * 0.7311 + 1.618) * Math.PI * 2
      const r = Math.sqrt((i + 0.5) / MESH.count) * 0.62
      return {
        x: 0.5 + Math.cos(theta) * r + (hash(i * 3.77 + seed * 1.093) - 0.5) * 0.26,
        y: 0.5 + Math.sin(theta) * r + (hash(i * 5.31 + seed * 2.236) - 0.5) * 0.26,
        px: hash(i * 7.13 + seed * 0.531) * Math.PI * 2,
        py: hash(i * 1.618 + seed * 3.71) * Math.PI * 2,
        pace: 0.5 + hash(i * 5.417 + seed * 0.291) * 0.7,
        tone: (i * 0.6180339887 + hash(seed * 0.531 + 0.77)) % 1,
      }
    })
  const num = x => x.toFixed(5)

  // A scene's whole picture in one pass, one effect per scene and theme, as its colours are part of it. The colours after
  // the package's MeshGradient: the plane swirled and warped, the colour points blended by distance and run through the
  // stops in Oklab, but warped with sines where it uses noise, which costs a fraction. Over them the contour lines, and
  // the glass for up to MAX_PANES panes, which bends both by working them out again where it looks. Each pane is a centre
  // (0..1 of the canvas, from its top left), a half width and half height (shares of the canvas's width and height) and a
  // corner radius (a share of its height); a pane with no width is not there. uv runs from the top left, as the page does.
  const defined = new Set()
  const backdrop = ({ defineShader, wgsl, registerShader, transformPosition }, spec, theme) => {
    const name = 'Backdrop' + spec.id + (theme === 'dark' ? 'Dark' : 'Light')
    if (defined.has(name)) return name
    defined.add(name)
    const spots = scatter(spec.seed)
    const stops = spec.stops[theme].map(oklab)
    const all = each => Array.from({ length: MAX_PANES }, (_, i) => each(i)).join(', ')
    const props = { bevel: { default: 0.02 }, thickness: { default: 0.03 }, absorb: { default: 0.1 }, vivid: { default: 0.2 }, ink: { default: 0.05 } }
    Object.assign(props, { bands: { default: FIELD.bands }, hair: { default: 0.001 }, pace: { default: 0 }, mx: { default: 0.5 }, my: { default: 0.5 }, hill: { default: 0 } })
    Object.assign(props, { speed: { default: 0 }, swirl: { default: 0.35 }, drift: { default: 0.4 }, pull: { default: 0 }, grain: { default: 0 } })
    for (let i = 0; i < MAX_PANES; i++)
      Object.assign(props, {
        [`c${i}`]: { default: { x: 0.5, y: 0.5 }, transform: transformPosition },
        [`w${i}`]: { default: 0 },
        [`h${i}`]: { default: 0 },
        [`r${i}`]: { default: 0 },
      })
    // The colours at p (in uv), into c<n>, in linear RGB.
    const colour = (n, p) => `
          let o${n} = vec2f(((${p}).x - 0.5) * aspect, (${p}).y - 0.5);
          let a${n} = -3.0 * swirl * smoothstep(0.0, 1.0, length(o${n}));
          let s${n} = (vec2f(o${n}.x * cos(a${n}) - o${n}.y * sin(a${n}), o${n}.x * sin(a${n}) + o${n}.y * cos(a${n})) + vec2f(aspect * 0.5, 0.5)) * 1.6;
          let v${n} = s${n} + 0.24 * vec2f(sin(s${n}.y * 1.7 + warp) + sin(s${n}.x * 0.9 - s${n}.y * 2.3 - warp * 1.3), sin(s${n}.x * 1.3 - warp * 1.1) + sin(s${n}.y * 0.8 + s${n}.x * 2.1 + warp * 0.7));
          let q${n} = (v${n} + 0.24 * vec2f(sin(v${n}.y * 2.3 - warp * 0.9 + 1.7), sin(v${n}.x * 1.9 + warp * 1.2 + 4.1))) / 1.6;
          let rc${n} = inverseSqrt(max(dot(q${n} - cursor, q${n} - cursor), 1e-4));
          let wc${n} = pull * rc${n} * rc${n} * rc${n};
          var sum${n} = wc${n} * ${num(spec.reach)};
          var weight${n} = wc${n};
          for (var j = 0; j < ${spots.length}; j++) {
            let rj = inverseSqrt(max(dot(q${n} - spots[j], q${n} - spots[j]), 1e-4));
            let wj = rj * rj * rj;
            sum${n} += wj * tones[j];
            weight${n} += wj;
          }
          let k${n} = clamp(sum${n} / weight${n}, 0.0, 1.0) * ${num(stops.length - 1)};
          let i${n} = min(u32(k${n}), ${stops.length - 2}u);
          let lab${n} = mix(stops[i${n}], stops[i${n} + 1u], k${n} - f32(i${n}));
          let e${n} = vec3f(dot(lab${n}, vec3f(1.0, 0.3963377774, 0.2158037573)), dot(lab${n}, vec3f(1.0, -0.1055613458, -0.0638541728)), dot(lab${n}, vec3f(1.0, -0.0894841775, -1.291485548)));
          let g${n} = e${n} * e${n} * e${n};
          let c${n} = max(vec3f(dot(g${n}, vec3f(4.0767416621, -3.3077115913, 0.2309699292)), dot(g${n}, vec3f(-1.2684380046, 2.6097574011, -0.3413193965)), dot(g${n}, vec3f(-0.0041960863, -0.7034186147, 1.707614701))), vec3f(0.0));`
    // The field the contour lines are drawn on, at p: sines bent by sines, in heights of the canvas, flowing slowly, with
    // a soft hill where the cursor is.
    const field = (n, p) => `
          let p${n} = (${p}) * viewport / unit * fold;
          let b${n} = vec2f(sin(p${n}.y * 2.1 + flow * 0.7), sin(p${n}.x * 1.7 - flow * 0.5));
          let f${n} = 0.5 * sin(p${n}.x * 2.3 + b${n}.x * 1.1 + flow) + 0.5 * sin(p${n}.y * 2.9 + b${n}.y * 1.3 - flow * 0.8) + 0.3 * sin((p${n}.x + p${n}.y) * 1.6 + flow * 0.6) + hill * exp(-dot(p${n} - mouse, p${n} - mouse) / 0.04);`
    registerShader(
      defineShader({
        name,
        props,
        paint: wgsl(`
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
            // Away from a pane nothing changes, and across its face only the tint: the bending is the rim's work alone.
            if (d > aa) { continue; }
            let inside = 1.0 - smoothstep(-aa, aa, d);
            face = max(face, inside);
            let w = min(wide, min(half.x, half.y) * 0.5);
            if (-d >= w) { continue; }
            var n = vec2f(0.0, sign(q.y));
            if (k.x > 0.0 && k.y > 0.0) { n = normalize(k) * sign(q); } else if (k.x > k.y) { n = vec2f(sign(q.x), 0.0); }
            let t = thick * w / wide;
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
          // Where the colour points have wandered to by now, the cursor's among them; the stops in Oklab.
          let clock = time * speed;
          let warp = clock * 0.125;
          let tw = clock * 0.11;
          var spots = array<vec2f, ${spots.length}>(${spots.map(s => `(vec2f(${num(s.x)}, ${num(s.y)}) + drift * 0.16 * vec2f(sin(tw * ${num(s.pace)} + ${num(s.px)}), cos(tw * ${num(s.pace * 1.37)} + ${num(s.py)}))) * vec2f(aspect, 1.0)`).join(', ')});
          var tones = array<f32, ${spots.length}>(${spots.map(s => num(s.tone)).join(', ')});
          var stops = array<vec3f, ${stops.length}>(${stops.map(c => `vec3f(${c.map(num).join(', ')})`).join(', ')});
          let cursor = vec2f(mx * aspect, my);
          // The contour lines, traced where the glass looks so they bend with the rest; a line keeps its width in pixels,
          // and fades where they crowd.
          let flow = time * pace;
          let fold = ${FIELD.fold.toFixed(2)};
          let mouse = vec2f(mx, my) * viewport / unit * fold;${colour('g', 'at')}${field('g', 'at')}
          var cr = cg;
          var cb = cg;
          var fr = fg;
          var fb = fg;
          // The colours split apart only on a rim, so only there is each worked out on its own.
          if (any(split != vec2f(0.0))) {${colour('R', 'at - split')}${colour('B', 'at + split')}${field('R', 'at - split')}${field('B', 'at + split')}
            cr = cR;
            cb = cB;
            fr = fR;
            fb = fB;
          }
          let level = vec3f(fr, fg, fb) * bands;
          let fine = max(fwidth(level), vec3f(1e-4));
          let lines = clamp(hair * unit * 0.5 + 0.5 - abs(fract(level + 0.5) - 0.5) / fine, vec3f(0.0), vec3f(1.0)) * (1.0 - smoothstep(vec3f(0.2), vec3f(0.6), fine));
          let below = mix(vec3f(cr.r, cg.g, cb.b), vec3f(select(1.0, 0.0, ink > 0.0)), abs(ink) * lines);
          let grey = vec3f(dot(below, vec3f(0.2126, 0.7152, 0.0722)));
          let seen = mix(grey, below, 1.0 + vivid * face) * (1.0 - absorb * face);
          // Film grain as the package's FilmGrain draws it, still and stronger where it is dark, over the glass (squeezed
          // by the bevel it would read as frost), in this pass rather than one of its own.
          let bits = bitcast<vec2u>(px * vec2f(141421356.0, 2718281828.0));
          let noise = f32((bits.x ^ bits.y) * 3141592653u) / 4294967295.0;
          let dark = 1.0 - clamp(dot(seen, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
          return vec4f(seen + (noise * 2.0 - 1.0) * dark * dark * grain * 0.1, 1.0);
        `),
      }),
    )
    return name
  }

  const scenes = []
  const drawAll = () => scenes.forEach(s => s.draw())
  let frames = null
  let rate = RATE.full

  // Two seconds of frames, a second after the page has loaded: twice late in a row halves the frames, the same picture,
  // and twice more steps it down a level and draws again. Images and fonts still arriving make a few frames late; a
  // device that can't keep up makes most of them late.
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
        strikes = gaps[gaps.length >> 1] > 20 ? strikes + 1 : 0
        if (strikes >= 2 && frames.rate > RATE.calm) {
          strikes = 0
          rate = frames.rate = RATE.calm
        } else if (strikes >= 2) {
          strikes = 0
          level -= 1
          drawAll()
          return
        } else if (!strikes) return
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
        frames = lib.frames
        const t = theme()
        const name = LEVELS[level]
        frames.rate = Math.min(rate, RATE[name])
        const props = { ...GLASS[t], ...MOTION[name], pace: FIELD.pace[name], grain: spec.grain[t], ...geometry() }
        const components = [{ type: backdrop(lib, spec, t), id: 'glass', props }]
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

    // The hill and the cursor's colour point ease after it across the section, and away again when it leaves.
    const mouse = { x: 0.5, y: 0.5, hill: 0, pull: 0 }
    const aim = { ...mouse }
    let isEasing = false
    const ease = () => {
      for (const k in mouse) mouse[k] += (aim[k] - mouse[k]) * 0.04
      if (shader && !isStill()) shader.update('glass', { mx: mouse.x, my: mouse.y, hill: mouse.hill, pull: mouse.pull })
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
        Object.assign(aim, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, hill: FIELD.hill, pull: MESH.pull })
        chase()
      })
      section.addEventListener('pointerleave', () => {
        aim.hill = 0
        aim.pull = 0
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
