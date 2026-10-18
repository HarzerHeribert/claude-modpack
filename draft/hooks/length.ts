// Writing to a length: the limit a prompt sets, a document's words as wc -w counts them, by section, and the two
// texts the mod adds. Pure: no I/O.
//
// From the beyond-click bench (results-beyond.jsonl, 18 Oct): asked to revise a guide to at most 700 words, Claude
// wrote the whole guide, counted 1,052 words, and wrote it again three times (798, 757, 694): each rewrite 2-7k
// output tokens, and each copy stays in the conversation. Tasks without a limit wrote once.

/** Files whose words are the point: prose, not code. */
export const PROSE = /\.(md|mdx|markdown|txt|rst|adoc)$/i

const NUMBER = String.raw`(\d{1,3}(?:[,.']\d{3})+|\d+)`
// "at most 700 words", "under 250 words", "no more than 400 words", "max. 500 words", "to 800 words", "in 150 words",
// "≤ 300 words"; German too: "höchstens 700 Wörter", "maximal 500 Wörter", "unter 300 Wörtern".
const BEFORE = String.raw`(?:at\s+most|under|no\s+more\s+than|not\s+more\s+than|fewer\s+than|less\s+than|up\s+to|within|below|max(?:imum)?\.?(?:\s+of)?|limit(?:ed)?\s+(?:of|to)|to|in|≤|<=?|höchstens|maximal|max\.?|unter|bis\s+zu|nicht\s+mehr\s+als|auf)`
const LIMIT = [
  new RegExp(String.raw`\b${BEFORE}\s+(?:about\s+|around\s+|ca\.?\s+|etwa\s+)?${NUMBER}\s*(?:words?|wörtern?|worte)\b`, 'giu'),
  new RegExp(String.raw`${NUMBER}\s*(?:words?|wörter)\s*(?:or\s+(?:fewer|less)|max(?:imum)?|at\s+most|oder\s+weniger|maximal|höchstens)\b`, 'giu'),
  new RegExp(String.raw`\b${NUMBER}-words?\b`, 'giu'),
]

const toNumber = (s: string) => Number.parseInt(s.replace(/[,.']/g, ''), 10)

/** The word limit a prompt sets, the last one it names; undefined when it sets none. */
export function limitOf(text: string): number | undefined {
  let found: { at: number; n: number } | undefined
  for (const re of LIMIT) {
    for (const m of text.matchAll(re)) {
      const n = toNumber(m[1] as string)
      if (n >= 20 && n <= 20_000 && (found === undefined || (m.index ?? 0) >= found.at)) found = { at: m.index ?? 0, n }
    }
  }
  return found?.n
}

/** Words as wc -w counts them: runs of non-space. */
export function wordsOf(text: string): number {
  const m = text.match(/\S+/g)
  return m === null ? 0 : m.length
}

export type Section = { title: string; words: number }

/** The document's parts by its second-level headings (else third-level), with what comes before the first. */
export function sectionsOf(text: string): Section[] {
  const lines = text.split('\n')
  let fence = false
  const heads: { line: number; level: number; title: string }[] = []
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const m = fence ? null : /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) heads.push({ line: i, level: (m[1] as string).length, title: m[2] as string })
  })
  const level = heads.some(h => h.level === 2) ? 2 : 3
  const cuts = heads.filter(h => h.level === level)
  if (cuts.length === 0) return []
  const out: Section[] = []
  const head = lines.slice(0, (cuts[0] as { line: number }).line).join('\n')
  if (wordsOf(head) > 0) out.push({ title: '(before the first section)', words: wordsOf(head) })
  cuts.forEach((c, i) => {
    const end = i + 1 < cuts.length ? (cuts[i + 1] as { line: number }).line : lines.length
    out.push({ title: c.title, words: wordsOf(lines.slice(c.line, end).join('\n')) })
  })
  return out
}

const n = (x: number) => x.toLocaleString('en-US')
const MAX_SECTIONS = 14
const MAX_TITLE = 40

/** Over by more than this share of the limit, one more full write at the target costs less than cutting with Edits:
 * an Edit repeats the text it changes, and a cut spread over the document changes most of it. */
export const REWRITE_OVER = 0.1
/** A rewrite aims here, as a share of the limit: a writer's count of its own words runs long. */
export const TARGET = 0.9

const short = (title: string) => (title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title)

/** What a write of a prose file shows: its words against the limit; when over, what to do and each section's target. */
export function gaugeText(path: string, text: string, limit: number): string {
  const words = wordsOf(text)
  if (words <= limit) return `${path}: ${n(words)} words (as wc -w counts), within the ${n(limit)} the prompt allows.`
  const over = words - limit
  const head = `${path}: ${n(words)} words (as wc -w counts), ${n(over)} over the ${n(limit)} the prompt allows.`
  if (over <= limit * REWRITE_OVER) return `${head} A small overrun: trim it with one Edit, or a few in one step.`
  const target = Math.floor(limit * TARGET)
  const scale = target / words
  const parts = sectionsOf(text)
  const shown = parts.slice(0, MAX_SECTIONS).map(s => `${short(s.title)} ${n(s.words)} → ${n(Math.max(1, Math.round(s.words * scale)))}`)
  const more = parts.length > MAX_SECTIONS ? ` · ${parts.length - MAX_SECTIONS} more` : ''
  return (
    `${head} Cuts this size change most of the text, and every Edit repeats what it changes: write it once more at about ${n(target)} words, every requested fact kept` +
    (shown.length > 0 ? `, each section at its target: ${shown.join(' · ')}${more}.` : '.')
  )
}

/**
 * The person's setting beside a prompt that sets a word limit. In the person's name, where orders are followed; it
 * says why, in what it costs.
 */
export function orderText(limit: number): string {
  const aim = Math.round((limit * 0.85) / 10) * 10
  return (
    `The person's setting for writing to a length (${n(limit)} words here): first drafts run long, often by a third, and every write of the whole text ` +
    `costs all of it again in output and stays in the conversation. So before writing, give each part its share of the words and aim for about ${n(aim)}, ` +
    `keeping every fact the request asks for: cut wording, not facts. If those facts cannot all fit, keep them and say how far over the limit it runs, rather than dropping any. ` +
    `Each write of the document then shows its words as wc -w counts them. If it is still well over, it shows each section's target: write it once more ` +
    `to those, in one step, rather than cutting it down in rounds; trim a small overrun with one Edit.`
  )
}
