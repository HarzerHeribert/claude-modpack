// How a cell draws in the transcript, after sterna's cells: a rounded card
// with the program dimmed, one row per call with its mark and time, and a
// closing line that carries the state. Only what is changing state moves:
// the scanner beside a running cell's state, and a turning disc on the call
// in flight.

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { CellsCall, CellsLive } from '../types'

export type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

export type CellState = 'writing' | 'running' | 'ran' | 'failed' | 'threw'

export type Card = {
  state: CellState
  code: string
  calls: readonly CellsCall[]
  now: number
  frame: number
  width: number
  summary: string
}

/** How wide the scanner is, and its two-cell head sweeping out and back. */
const SCAN = 10
const TURN = ['◐', '◓', '◑', '◒'] as const
const VERB: Record<string, string> = { Bash: 'sh', Read: 'read', Edit: 'edit', Write: 'write', LSP: 'lsp' }
const CODE_LINES = 6

export function scanner(frame: number): { before: string; head: string; after: string } {
  const span = SCAN - 2
  const t = frame % (2 * span)
  const at = t <= span ? t : 2 * span - t
  return { before: '·'.repeat(at), head: '━━', after: '·'.repeat(span - at) }
}

/** A cell's state from its own record: running until it has ended, whatever its row says. */
export function stateOf(live: CellsLive, rowRunning: boolean): CellState {
  if (rowRunning || live.endedAt === undefined) return 'running'
  if (live.error) return 'threw'
  return live.calls.some(c => c.state !== 'ok' && c.state !== 'running') ? 'failed' : 'ran'
}

export function seconds(ms: number): string {
  return ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

function fit(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > room ? `${flat.slice(0, Math.max(1, room - 1))}…` : flat
}

const TONE: Record<CellState, string> = { writing: 'claude', running: 'claude', ran: 'success', failed: 'warning', threw: 'error' }

export function cellCard({ Box, Text }: Elements, c: Card): RenderElement {
  const inner = Math.max(24, c.width - 6)
  const sweep = scanner(c.frame)
  const program = c.code.replace(/\s+$/, '')
  const lines = program === '' ? [] : program.split('\n')
  const moving = c.state === 'running' || c.state === 'writing'
  const shown = lines.slice(0, CODE_LINES)

  const footer = (
    <Box flexDirection="row" gap={1}>
      <Text bold color={TONE[c.state]}>
        {c.state}
      </Text>
      {moving ? (
        <Text>
          <Text color="inactive">{sweep.before}</Text>
          <Text color="claude">{sweep.head}</Text>
          <Text color="inactive">{sweep.after}</Text>
        </Text>
      ) : null}
      {c.summary ? <Text color="subtle">{`· ${c.summary}`}</Text> : null}
    </Box>
  )

  const code = lines.length === 0 ? null : (
    <Box flexDirection="column" paddingLeft={2}>
      {shown.map(line => (
        <Text color="subtle" wrap="truncate-end">
          {line.length > inner ? `${line.slice(0, inner - 1)}…` : line || ' '}
        </Text>
      ))}
      {lines.length > CODE_LINES ? <Text color="inactive">{`… ${lines.length - CODE_LINES} more lines`}</Text> : null}
    </Box>
  )

  const rows = c.calls.map(call => {
    const mark =
      call.state === 'running'
        ? TURN[c.frame % TURN.length]
        : call.state === 'ok'
          ? '✓'
          : call.state === 'refused'
            ? '⊘'
            : '✕'
    const markTone = call.state === 'running' ? 'claude' : call.state === 'ok' ? 'success' : call.state === 'refused' ? 'warning' : 'error'
    const ms = call.state === 'running' ? c.now - call.startedAt : (call.ms ?? 0)
    const note = call.note ? `  ${call.note}` : ''
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1} flexShrink={1}>
          <Text color={markTone}>{mark}</Text>
          <Text color="subtle">{(VERB[call.tool] ?? call.tool).padEnd(5)}</Text>
          <Text wrap="truncate-end">{fit(call.label, inner - 16 - note.length)}</Text>
          {note ? <Text color="warning">{note.trim()}</Text> : null}
        </Box>
        <Text color="subtle">{seconds(ms)}</Text>
      </Box>
    )
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={moving ? 'claude' : 'subtle'} paddingX={1}>
      {code}
      {rows.length > 0 ? <Box flexDirection="column">{rows}</Box> : null}
      {footer}
    </Box>
  )
}

/** A finished cell rebuilt from the report the model read: its header and call rows. */
export function parseReport(text: string): { summary: string; calls: CellsCall[]; state: CellState } {
  const all = text.split('\n')
  const summary = (all[0] ?? '').replace(/^cell · /, '')
  const calls: CellsCall[] = []
  for (const line of all.slice(1)) {
    const m = /^ {2}([✓✕⊘]) (\S+)\s+(.*?)\s{2}(?:(refused|exit \d+)\s{2})?([\d.]+) s$/.exec(line)
    if (!m) break
    const verb = m[2] ?? ''
    const tool = Object.entries(VERB).find(([, v]) => v === verb)?.[0] ?? verb
    const state = m[1] === '✓' ? 'ok' : m[1] === '⊘' ? 'refused' : 'failed'
    calls.push({ tool, label: m[3] ?? '', state, startedAt: 0, ms: Number(m[5]) * 1000, note: m[4] })
  }
  const threw = /\n## Error\n/.test(text)
  const failed = calls.some(c => c.state !== 'ok')
  return { summary, calls, state: threw ? 'threw' : failed ? 'failed' : 'ran' }
}

export type LineTone = 'error' | 'warning' | 'success' | undefined

const ERROR_LINE = /\berror\b|\bfail(?:ed|s|ure|ures)?\b|✕|✘|\bTraceback\b|\bpanicked\b|\bexception\b|\bexit [1-9]|^E\s/i
const NOT_ERROR = /\b0 (?:errors?|fail(?:ed|s|ures?)?)\b|\bno errors?\b/i
const WARN_LINE = /\bwarn(?:ing)?s?\b|⚠/i
const PASS_LINE = /✔|✓|\bpass(?:ed|es)?\b|\bok\b|\bsucceeded\b/i

/** What a line of a result says, by its words: an error (and the indented lines under one), a warning, a pass. */
export function toneOf(line: string, previous: LineTone): LineTone {
  if (previous === 'error' && /^\s+\S/.test(line) && !PASS_LINE.test(line)) return 'error'
  if (ERROR_LINE.test(line) && !NOT_ERROR.test(line)) return 'error'
  if (WARN_LINE.test(line)) return 'warning'
  if (PASS_LINE.test(line) || NOT_ERROR.test(line)) return 'success'
  return undefined
}

const LOCATION = /^(\s*)((?:[\w@.~-]+\/)*[\w@.~-]+\.\w+(?:\(\d+,\d+\)|:\d+(?::\d+)?):?)(.*)$/

/** A line that starts with where it is about (`a.ts(3,5):`, `a.py:12:`): that place, and the rest. */
export function splitLocation(line: string): { indent: string; at: string; rest: string } | undefined {
  const m = LOCATION.exec(line)
  return m ? { indent: m[1] ?? '', at: m[2] ?? '', rest: m[3] ?? '' } : undefined
}

const SECTION_TONE: Record<string, string> = { error: 'error', repair: 'warning', fix: 'warning', notes: 'suggestion', handles: 'inactive' }
/** Lines a section may take before the long ones share the rest: what went wrong first. */
const SECTION_CAP: Record<string, number> = { error: 8, repair: 8, fix: 2, notes: 4 }
const PRIORITY = ['error', 'repair', 'fix', 'notes', 'output', 'log', 'handles']

/** The part of the report after the call rows: each section under its heading, its lines coloured by what they say, about `room` lines in all. */
export function resultBody({ Box, Text }: Elements, text: string, room = 14): RenderElement | undefined {
  const all = text.split('\n')
  const start = all.findIndex(l => l.startsWith('## '))
  if (start < 0) return undefined
  const sections: { name: string; lines: string[] }[] = []
  for (const line of all.slice(start)) {
    if (line.startsWith('## ')) sections.push({ name: line.slice(3).toLowerCase(), lines: [] })
    else sections.at(-1)?.lines.push(line)
  }

  // What went wrong is shown first and whole (up to its cap); the rest share what is left, two lines each at least.
  const take = new Map<(typeof sections)[number], number>()
  let left = room
  const order = [...sections].sort((a, b) => (PRIORITY.indexOf(a.name) + 1 || 99) - (PRIORITY.indexOf(b.name) + 1 || 99))
  for (const s of order) {
    const want = Math.min(s.lines.length, SECTION_CAP[s.name] ?? s.lines.length)
    const n = Math.min(s.lines.length, Math.max(Math.min(want, left), 2))
    take.set(s, n)
    left = Math.max(0, left - n)
  }

  const row = (line: string, tone: LineTone) => {
    if (line.startsWith('### ')) {
      return (
        <Text bold color="claude">
          {line.slice(4)}
        </Text>
      )
    }
    const place = splitLocation(line)
    if (place === undefined) {
      return (
        <Text wrap="truncate-end" color={tone}>
          {line || ' '}
        </Text>
      )
    }
    return (
      <Text wrap="truncate-end">
        {place.indent}
        <Text color="suggestion">{place.at}</Text>
        <Text color={tone}>{place.rest}</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {sections.map(s => {
        // A value returned as named parts (\`### tsc\`, \`### tests\`) shows every part, each with its share of the lines.
        const parts = partsOf(s.lines)
        const takes = share(parts, take.get(s) ?? 0)
        return (
          <Box flexDirection="column">
            <Text bold color={SECTION_TONE[s.name] ?? 'subtle'}>
              {s.name}
            </Text>
            <Box flexDirection="column" paddingLeft={1}>
              {parts.map((p, k) => {
                const n = takes[k] ?? 0
                let tone: LineTone
                return (
                  <Box flexDirection="column">
                    {p.head !== undefined ? (
                      <Text bold color="claude">
                        {p.head}
                      </Text>
                    ) : null}
                    {p.lines.slice(0, n).map(line => {
                      tone = s.name === 'handles' ? undefined : toneOf(line, tone)
                      return row(line, s.name === 'error' ? 'error' : tone)
                    })}
                    {p.lines.length > n ? <Text color="inactive">{`… ${p.lines.length - n} more lines (ctrl+o)`}</Text> : null}
                  </Box>
                )
              })}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** A section's lines split at its \`### name\` headings. */
function partsOf(lines: readonly string[]): { head?: string; lines: string[] }[] {
  const parts: { head?: string; lines: string[] }[] = [{ lines: [] }]
  for (const line of lines) {
    if (line.startsWith('### ')) parts.push({ head: line.slice(4), lines: [] })
    else parts.at(-1)?.lines.push(line)
  }
  return parts.filter(p => p.head !== undefined || p.lines.length > 0)
}

/** `n` lines shared among the parts: two each at least, the rest in order. */
function share(parts: readonly { lines: readonly string[] }[], n: number): number[] {
  const takes = parts.map(p => Math.min(p.lines.length, 2))
  let left = Math.max(0, n - takes.reduce((a, b) => a + b, 0))
  for (let k = 0; k < parts.length && left > 0; k++) {
    const more = Math.min((parts[k]?.lines.length ?? 0) - (takes[k] ?? 0), left)
    takes[k] = (takes[k] ?? 0) + more
    left -= more
  }
  return takes
}
