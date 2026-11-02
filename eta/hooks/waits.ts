/**
 * Waits that hold each other. `until ! pgrep -f 'X'` waits while any process's command line holds X,
 * and pgrep skips only its own shell and that shell's ancestors: a second waiter whose command line
 * holds X, and whose own pattern finds the first, keeps both waiting for good.
 */

/** pgrep's options that take a value (macOS and Linux): the word after one is no pattern. */
const TAKES_VALUE = new Set(['d', 'F', 'g', 'G', 'M', 'N', 'P', 's', 't', 'u', 'U', 'c', 'J', 'r'])
/** What ends a simple command's words. */
const ENDS = new Set([';', '|', '&', '(', ')', '\n', '`', '<', '>'])

type Word = { text: string; literal: boolean }

/** A here-document is a file's text, not commands: its lines are left out, with the line that opens it. */
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g

/**
 * The shell words from the start of `s` to the first operator, quotes removed; `literal` is false
 * where `$` could expand. `piped`: the operator is a pipe, so the output is read on.
 */
function words(s: string): { ws: Word[]; piped: boolean } {
  const out: Word[] = []
  let cur: Word | undefined
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (c === ' ' || c === '\t' || ENDS.has(c)) {
      if (cur) out.push(cur)
      cur = undefined
      if (ENDS.has(c)) return { ws: out, piped: c === '|' && s[i + 1] !== '|' }
      continue
    }
    cur ??= { text: '', literal: true }
    if (c === "'") {
      const end = s.indexOf("'", i + 1)
      cur.text += s.slice(i + 1, end < 0 ? s.length : end)
      i = end < 0 ? s.length : end
    } else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length) i++
        else if (s[i] === '$' || s[i] === '`') cur.literal = false
        cur.text += s[i]
      }
    } else if (c === '\\') {
      cur.text += s[++i] ?? ''
    } else {
      if (c === '$') cur.literal = false
      cur.text += c
    }
  }
  if (cur) out.push(cur)
  return { ws: out, piped: false }
}

/**
 * The patterns a shell command waits on with `pgrep -f`: a presence test in an `until` or `while`
 * condition. A count (`$(pgrep … | wc -l)`), a list piped on, a one-off check and a pattern that
 * names a variable are left out.
 */
export function pgrepPatterns(command: string): RegExp[] {
  const out: RegExp[] = []
  command = command.replace(HEREDOC, '')
  for (const m of command.matchAll(/(^|[\s;|&(`!])pgrep(?=[ \t])/g)) {
    const at = (m.index ?? 0) + (m[1] ?? '').length
    const before = command.slice(0, at)
    const keyword = [...before.matchAll(/\b(until|while|do|done|then|else|fi)\b/g)].pop()?.[1]
    if (keyword !== 'until' && keyword !== 'while') continue
    if (/(\$\(|`)\s*$/.test(before)) continue
    const { ws, piped } = words(command.slice(at + 'pgrep'.length))
    if (piped) continue
    let full = false
    let i = 0
    for (; i < ws.length; i++) {
      const w = (ws[i] as Word).text
      if (w === '--') {
        i++
        break
      }
      if (!w.startsWith('-') || w === '-') break
      if (w.startsWith('--')) {
        if (w === '--full') full = true
        continue
      }
      if (w.includes('f')) full = true
      if (TAKES_VALUE.has(w[w.length - 1] as string)) i++
    }
    const pattern = ws[i]
    if (!full || !pattern?.literal || pattern.text === '') continue
    try {
      out.push(new RegExp(pattern.text))
    } catch {
      // A pattern JavaScript cannot read is left out.
    }
  }
  return out
}

/** The running task this command's `pgrep -f` would find while that task's own finds this command: each would wait for the other. */
export function mutualWait(command: string, tasks: readonly { id: string; command?: string }[]): { id: string; pattern: string } | undefined {
  const mine = pgrepPatterns(command)
  if (mine.length === 0) return undefined
  for (const t of tasks) {
    const theirs = t.command
    if (theirs === undefined) continue
    const hit = mine.find(p => p.test(theirs))
    if (hit && pgrepPatterns(theirs).some(p => p.test(command))) return { id: t.id, pattern: hit.source }
  }
  return undefined
}
