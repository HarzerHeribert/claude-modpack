// How a hand-off draws: in the transcript, a card that stays live while its
// worker runs (a turning disc, a scanner, the clock, requests, cost and its
// last actions) and then reads as an outcome; and a pane, opened from the
// card, that lists everything each worker did and, once in, its report.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { DelegateAction, DelegateJob } from '../types'

export type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export const FRAME_MS = 250
const TURN = ['◐', '◓', '◑', '◒'] as const
const SCAN = 8
const VERB: Record<string, string> = { Bash: 'run', Read: 'read', Edit: 'edit', Write: 'write', LSP: 'lsp', Grep: 'grep', Glob: 'glob', SubagentHandback: 'report' }
const RECENT = 3

export function scanner(frame: number): { before: string; head: string; after: string } {
  const span = SCAN - 2
  const t = frame % (2 * span)
  const at = t <= span ? t : 2 * span - t
  return { before: '·'.repeat(at), head: '━━', after: '·'.repeat(span - at) }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

export function fit(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > room ? `${flat.slice(0, Math.max(1, room - 1))}…` : flat
}

/** What a worker's tool call was about, in a few words. */
export function actionLabel(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const short = (p: string) => p.split('/').slice(-2).join('/')
  if (tool === 'Bash') return s('command').split('\n')[0] ?? ''
  if (tool === 'LSP') return `${s('operation')} ${short(s('filePath'))}:${String(input.line ?? '')}`
  if (tool === 'Grep' || tool === 'Glob') return s('pattern')
  return short(s('file_path') || s('path') || s('filePath'))
}

const verb = (tool: string) => VERB[tool] ?? tool.replace(/^mcp__\w+__/, '').toLowerCase()

/** The card's head: what state, which worker, how far. */
export function headline(j: DelegateJob, now: number): string {
  const time = clock((j.endedAt ?? now) - j.startedAt)
  const req = `${j.requests} req`
  const cost = usd(j.usd)
  if (j.state === 'running') return `hand-off ${j.n} · ${j.mode} · ${j.model}${j.reused ? ' (warm)' : ''} · ${time} · ${req} · ${cost}`
  const saved = j.aloneUsd !== undefined ? ` · on your model ≈ ${usd(j.aloneUsd)}` : ''
  return `hand-off ${j.n} · ${j.mode} · ${j.model} · ${time} · ${req} · ${cost}${saved}`
}

/** The outcome line under a finished card: what changed and whether the check held. */
export function outcome(j: DelegateJob): string | undefined {
  if (j.state === 'running') return undefined
  const parts: string[] = []
  if (j.mode === 'edit') {
    const n = j.files?.length ?? 0
    parts.push(n === 0 ? 'no file changed' : `+${j.added ?? 0} −${j.removed ?? 0} in ${n} file${n === 1 ? '' : 's'}`)
    if (j.check) parts.push(j.check.exit === 0 ? 'check passed' : `check failed (exit ${j.check.exit})`)
    if (j.verdict) parts.push(`review: ${j.verdict}`)
  } else {
    parts.push(`${j.actions.length} step${j.actions.length === 1 ? '' : 's'} read`)
  }
  if (j.reach > 0) parts.push(`reach: ${j.reach} reference${j.reach === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function actionRow({ Box, Text }: Elements, a: DelegateAction, now: number, frame: number, room: number, key: string): RenderElement {
  const mark = a.state === 'running' ? TURN[frame % TURN.length] : a.state === 'ok' ? '✓' : '✕'
  const tone = a.state === 'running' ? 'claude' : a.state === 'ok' ? 'success' : 'error'
  const time = a.state === 'running' ? clock(now - a.startedAt) : a.ms !== undefined ? clock(a.ms) : ''
  return (
    <Box key={key} flexDirection="row" gap={1}>
      <Text color={tone}>{mark}</Text>
      <Text>{verb(a.tool).padEnd(5)}</Text>
      <Text dimColor wrap="truncate-end">
        {fit(a.label, Math.max(8, room - 16))}
      </Text>
      <Text dimColor>{time}</Text>
    </Box>
  )
}

export function jobCard(el: Elements, j: DelegateJob, now: number, width: number, onOpen: () => void): RenderElement {
  const { Box, Text, Button } = el
  const frame = Math.floor(now / FRAME_MS)
  const room = Math.max(30, width - 4)
  const running = j.state === 'running'
  const mark = running ? TURN[frame % TURN.length] : j.state === 'reported' ? '✓' : '✕'
  const tone = running ? 'claude' : j.state === 'reported' ? (j.check && j.check.exit !== 0 ? 'warning' : 'success') : 'error'
  const sweep = scanner(frame)
  const recent = j.actions.slice(-RECENT)
  const line = outcome(j)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={tone}>{mark}</Text>
        <Text bold color={tone}>
          {fit(headline(j, now), Math.max(20, room - (running ? 24 : 12)))}
        </Text>
        {running && (
          <Text>
            <Text dimColor>{sweep.before}</Text>
            <Text color="claude">{sweep.head}</Text>
            <Text dimColor>{sweep.after}</Text>
          </Text>
        )}
        <Button key={`open-${j.toolUseId}`} plain dimColor label={running ? 'watch ▸' : 'view ▸'} onPress={onOpen} />
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor>{fit(j.task, room - 2)}</Text>
        {running && recent.length === 0 && <Text dimColor>starting…</Text>}
        {running && recent.map((a, i) => actionRow(el, a, now, frame, room - 2, `a${i}`))}
        {line !== undefined && <Text dimColor>{fit(line, room - 2)}</Text>}
      </Box>
    </Box>
  )
}

/** The pane: the watched hand-off with all its worker did and its report, the others below; the engine scrolls it. */
export function pane(el: Elements, jobs: readonly DelegateJob[], watching: string | null, now: number, width: number, onPick: (id: string) => void): RenderElement {
  const { Box, Text, Button } = el
  const frame = Math.floor(now / FRAME_MS)
  const room = Math.max(24, width)
  if (jobs.length === 0) return <Text dimColor>No hand-offs in this session yet.</Text>
  const open = jobs.find(j => j.toolUseId === watching) ?? (jobs.at(-1) as DelegateJob)
  const others = jobs.filter(j => j !== open).reverse()
  const line = outcome(open)
  return (
    <Box flexDirection="column">
      <Text bold color={open.state === 'running' ? 'claude' : open.state === 'reported' ? 'success' : 'error'}>
        {headline(open, now)}
      </Text>
      <Text dimColor>{open.task}</Text>
      {line !== undefined && <Text>{line}</Text>}
      <Text dimColor>worker {open.agentId}</Text>
      <Text> </Text>
      {open.actions.length === 0 && <Text dimColor>starting…</Text>}
      {open.actions.map((a, i) => actionRow(el, a, now, frame, room, `p${i}`))}
      {open.report !== undefined && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Report</Text>
          <Text>{open.report}</Text>
        </Box>
      )}
      {others.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Earlier hand-offs</Text>
          {others.map(j => (
            <Button
              key={`pick-${j.toolUseId}`}
              plain
              dimColor
              label={fit(`${j.state === 'running' ? TURN[frame % TURN.length] : j.state === 'reported' ? '✓' : '✕'} ${headline(j, now)}`, room)}
              onPress={() => onPick(j.toolUseId)}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
