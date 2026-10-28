import type { Job } from '../types'

export type { Job }

/** What a count of things is in: "123/456 files", "12 of 50 tests". */
const UNITS =
  'files?|items?|tests?|steps?|tasks?|rows?|records?|pages?|modules?|packages?|chunks?|batches?|docs?|documents?|urls?|requests?|images?|samples?|objects?|commits?|entries|repos?|targets?|jobs?|cases?|queries|examples?|questions?|prompts?|shards?|epochs?'
/** What a tool says it is doing beside a percentage: "Downloading: 45%". */
const DOING =
  'downloading|uploading|installing|building|compiling|indexing|processing|extracting|copying|syncing|loading|training|encoding|transcoding|rendering|exporting|importing|migrating|scanning|pushing|pulling|fetching|cloning|converting|analy[sz]ing|generating|verifying|unpacking'

/** Progress lines common tools print, tried in order when Claude named no pattern; the first that reads wins. */
const AUTO: { re: RegExp; read: (m: RegExpMatchArray) => number | undefined }[] = [
  { re: /(\d{1,3}(?:\.\d+)?)%\|/, read: m => pct(m[1]) },                                  // tqdm
  { re: /\[\s*(\d{1,3})%\]/, read: m => pct(m[1]) },                                        // pytest, CMake, apt
  { re: /Building \[[^\]]*\]\s*(\d+)\/(\d+)/, read: m => ratio(m[1], m[2]) },              // cargo
  { re: /\[(\d+)\/(\d+)\]/, read: m => ratio(m[1], m[2]) },                                 // ninja, docker, [3/10]
  { re: /:\s+\d{1,3}% \((\d+)\/(\d+)\)/, read: m => ratio(m[1], m[2]) },                    // git: "Receiving objects:  45% (4500/10000)"
  { re: /to-chk=(\d+)\/(\d+)/, read: m => ratio(String(Number(m[2]) - Number(m[1])), m[2]) }, // rsync --info=progress2
  { re: /\b(\d+)\/(\d+)\s*\[[=>.#\-━─ ]*\]/, read: m => ratio(m[1], m[2]) },                // Keras: "125/500 [=====>....]"
  { re: /[━─■█#=]{3,}\s*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*[kKMGT]?i?B\b/, read: m => ratio(m[1], m[2]) }, // pip, rich
  { re: /(\d{1,3}(?:\.\d+)?)%\s*(?:\[[=>#\- ]*\]|[\d.,]+\s*[kKMGT]?i?B(?:\/s)?\b)/, read: m => pct(m[1]) }, // wget, rsync: a bar or a size beside it
  { re: /#{4,}\s*(\d{1,3}(?:\.\d+)?)%/, read: m => pct(m[1]) },                              // curl -#, Homebrew
  { re: new RegExp(`\\b(\\d+)\\s*(?:\\/|of)\\s*(\\d+)\\s+(?:${UNITS})\\b`, 'i'), read: m => ratio(m[1], m[2]) },
  { re: /\b(?:step|task|test|file|item|batch|epoch|attempt|block|run|job|shard|chunk|page)s?\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i, read: m => ratio(m[1], m[2]) },
  { re: /\b(?:processed|downloaded|uploaded|indexed|scanned|copied|converted|migrated|imported|exported|fetched|checked)\s+(\d+)\s*(?:\/|of)\s*(\d+)/i, read: m => ratio(m[1], m[2]) },
  { re: /\b(?:progress|done|completed?)\b\D{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i, read: m => pct(m[1]) },
  { re: new RegExp(`\\b(?:${DOING})\\b[^\\d%]{0,20}(\\d{1,3}(?:\\.\\d+)?)\\s*%`, 'i'), read: m => pct(m[1]) },
]

/** The progress a line shows by itself, as a fraction, when it is one a common tool prints. */
export function readAuto(line: string): number | undefined {
  for (const { re, read } of AUTO) {
    const m = line.match(re)
    const v = m ? read(m) : undefined
    if (v !== undefined) return v
  }
  return undefined
}

function pct(s: string | undefined) {
  const v = Number(s)
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : undefined
}

function ratio(a: string | undefined, b: string | undefined) {
  const x = Number(a)
  const y = Number(b)
  return y > 0 && x >= 0 && x <= y ? x / y : undefined
}

/** Reads one progress line with a pattern Claude gave: named or positional groups. */
function readPattern(m: RegExpMatchArray) {
  const g = m.groups ?? {}
  if (g.done !== undefined && g.total !== undefined) return ratio(g.done, g.total)
  if (g.pct !== undefined) return pct(g.pct)
  if (m[2] !== undefined) return ratio(m[1], m[2])
  return pct(m[1])
}

export function compile(source: string | undefined) {
  if (!source) return undefined
  try {
    return new RegExp(source)
  } catch {
    return undefined
  }
}

/**
 * Feeds new output to a job: counts done lines, reads the latest progress line, notices a finish
 * line. A partial last line waits in `carry` for the rest. Returns the updated job.
 */
export function feed(job: Job, text: string, now: number): Job {
  const all = job.carry + text
  const parts = all.split(/\r\n|\r|\n/)
  const carry = /[\r\n]$/.test(all) ? '' : (parts.pop() ?? '')
  if (carry === '' && parts.at(-1) === '') parts.pop()
  const done = compile(job.donePattern)
  const progress = compile(job.progressPattern)
  const finished = compile(job.finishedPattern)
  let count = job.done
  let frac = job.frac
  let ended = false
  let lastLine = job.lastLine
  // A bar redrawn with \r is still mid-line: read it too, without keeping it.
  for (const line of [...parts, carry]) {
    if (line.trim() !== '') lastLine = line.trim()
    if (line !== carry && done?.test(line)) count++
    if (progress) {
      const m = line.match(progress)
      const v = m ? readPattern(m) : undefined
      if (v !== undefined) frac = v
    } else if (!done) {
      const v = readAuto(line)
      if (v !== undefined) frac = v
    }
    if (line !== carry && finished?.test(line)) ended = true
  }
  if (done && job.total) frac = Math.min(1, count / job.total)
  const moved = frac !== undefined && frac !== job.frac
  const samples = moved ? thin([...job.samples, [now, frac as number]]) : job.samples
  let next: Job = { ...job, carry: carry.slice(-4000), lastLine, done: count, frac, samples, lastProgressAt: moved ? now : job.lastProgressAt }
  if (ended || (frac !== undefined && frac >= 1)) next = { ...next, status: 'completed', endedAt: now }
  return next
}

/** Keeps the first sample and at most 120 after it. */
function thin(samples: [number, number][]) {
  return samples.length <= 121 ? samples : [samples[0] as [number, number], ...samples.slice(-120)]
}

export type Estimate = {
  frac?: number
  /** When it will likely finish, and a range from the overall and the recent rate. */
  at?: number
  lo?: number
  hi?: number
  basis: 'measured' | 'guess' | 'none'
  /** How long since progress last moved, once that is unusually long. */
  stalledMs?: number
}

export function estimate(job: Job, now: number): Estimate {
  const frac = job.frac
  const stalledMs = stalled(job, now)
  const first = job.samples[0]
  if (frac !== undefined && first && frac > first[1] && now > first[0]) {
    const elapsed = now - first[0]
    const overall = (frac - first[1]) / elapsed
    const window = Math.max(elapsed / 4, 60_000)
    const back = [...job.samples].reverse().find(([t]) => t <= now - window) ?? first
    const recent = (frac - back[1]) / (now - back[0])
    const remaining = 1 - frac
    let mid = remaining / overall
    if (job.expectedMs && frac < 0.1) {
      const w = frac / 0.1
      mid = w * mid + (1 - w) * Math.max(0, job.startedAt + job.expectedMs - now)
    }
    const fast = Math.max(overall, recent)
    const slow = Math.min(overall, recent)
    return {
      frac, at: now + mid, lo: now + Math.min(mid, remaining / fast),
      hi: slow > 0 ? now + Math.max(mid, remaining / slow) : undefined, basis: 'measured', stalledMs,
    }
  }
  if (job.expectedMs) return { frac, at: job.startedAt + job.expectedMs, basis: 'guess', stalledMs }
  return { frac, basis: 'none', stalledMs }
}

/** Progress that has not moved for three times its usual gap, and at least two minutes. */
function stalled(job: Job, now: number) {
  if (job.status !== 'running' || job.lastProgressAt === undefined || job.samples.length < 3) return undefined
  const first = job.samples[0] as [number, number]
  const gap = (job.lastProgressAt - first[0]) / (job.samples.length - 1)
  const quiet = now - job.lastProgressAt
  return quiet > Math.max(3 * gap, 120_000) ? quiet : undefined
}

export function duration(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** hh:mm in the person's time zone, given its offset from UTC in minutes. */
export function clock(ms: number, tzOffsetMin: number) {
  const d = new Date(ms + tzOffsetMin * 60_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function bar(frac: number, cells = 10) {
  const full = Math.max(0, Math.min(cells, Math.round(frac * cells)))
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

/** One line for a job: what a status line or a band row says. */
export function describe(job: Job, now: number, tz: number | null) {
  const label = job.label.length > 32 ? job.label.slice(0, 31) + '…' : job.label
  if (job.status !== 'running') {
    const took = duration((job.endedAt ?? now) - job.startedAt)
    const word = job.status === 'completed' ? `done in ${took}` : job.status === 'failed' ? `failed after ${took}` : `stopped after ${took}`
    return { label, progress: '', eta: word }
  }
  const e = estimate(job, now)
  const count = job.donePattern && job.total ? ` ${job.done}/${job.total}` : ''
  const progress = e.frac === undefined ? '' : `${bar(e.frac)} ${Math.floor(e.frac * 100)}%${count}`
  const at = (ms: number) => (tz === null ? `in ${duration(ms - now)}` : clock(ms, tz))
  let eta: string
  if (e.basis === 'measured' && e.at !== undefined) {
    const range = e.lo !== undefined && e.hi !== undefined && e.hi - e.lo >= 4 * 60_000 ? ` (${at(e.lo)}–${at(e.hi)})` : ''
    eta = `ETA ${at(e.at)}${tz === null ? '' : ` · in ${duration(e.at - now)}`}${range}`
  } else if (e.basis === 'guess' && e.at !== undefined) {
    eta = e.at > now ? `ETA ~${at(e.at)} (Claude's guess)` : `past Claude's guess of ${duration((job.expectedMs ?? 0))}`
  } else {
    eta = `running ${duration(now - job.startedAt)}${e.frac === undefined ? ' · no progress readable yet' : ' · measuring'}`
  }
  if (e.stalledMs !== undefined) eta += ` · no progress for ${duration(e.stalledMs)}`
  return { label, progress, eta }
}

const SETUP = /^(cd\s+\S+|export\s+\S+|source\s+\S+|\.\s+\S+|set\s+-\S+|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))$/
const WRAPPERS = new Set(['timeout', 'nohup', 'time', 'env', 'exec', 'caffeinate', 'nice'])

/**
 * A job's name when the call gave no description: the command that does the work, not the `cd`, exports and variable
 * assignments in front of it ("cd ~/x && BENCH_RESULTS=r.jsonl python3 bench.py run --arms a" → "bench.py run --arms a").
 */
export function commandLabel(command: string, max = 48): string {
  const first = command.split('\n')[0]?.trim() ?? ''
  const steps = first.split(/\s*(?:&&|;|\|\|)\s*/).map(s => s.trim()).filter(Boolean)
  let step = steps.find(s => !SETUP.test(s)) ?? steps[steps.length - 1] ?? first
  // Assignments and wrappers before the program ("A=1 B=2 timeout 600 python3 x.py").
  let words = step.split(/\s+/)
  while (words.length > 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] as string) || WRAPPERS.has(words[0] as string) || /^\d+[smh]?$/.test(words[0] as string))) words = words.slice(1)
  // An interpreter names nothing: show its script.
  if (words.length > 1 && /^(python3?|node|bash|sh|zsh|ruby|perl|bun|deno|uv|npx)$/.test(words[0] as string) && !(words[1] as string).startsWith('-')) words = words.slice(1)
  if (words[0]?.includes('/')) words[0] = (words[0] as string).split('/').pop() as string
  // What the output goes to (a pipe, a redirection) is not the job's name.
  step = words.join(' ').replace(/\s*\|.*$/, '').replace(/\s*\d?>>?&?\s*\S+/g, '').trim()
  return step.length > max ? `${step.slice(0, max - 1)}…` : step
}
