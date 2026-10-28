import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { Budget, costOf, inTemp, kindOf, missed, noteFor } from '../hooks/nudge'
import type { Step } from '../hooks/nudge'

const NOW = 1_000_000_000

const step = (index: number, calls: Step['calls'], over: Partial<Step> = {}): Step => ({
  turnId: 't1',
  index,
  calls,
  ok: calls.map(() => true),
  readTokens: 400_000,
  uncachedTokens: 20,
  model: 'claude-opus-5-5',
  ms: 4200,
  ...over,
})
const edit = { tool: 'Edit', kind: 'edit' as const }
const bash = (command: string) => ({ tool: 'Bash', kind: kindOf('Bash', { command }), command })

describe('what a call is', () => {
  test('edits, checks, scripts', () => {
    expect(kindOf('Edit', {})).toBe('edit')
    expect(kindOf('Write', {})).toBe('edit')
    expect(kindOf('Bash', { command: 'npx tsc -p . 2>&1 | head' })).toBe('check')
    expect(kindOf('Bash', { command: 'cd x && python3 -m pytest -q' })).toBe('check')
    expect(kindOf('Bash', { command: "python3 - <<'EOF'\ns=open(p).read(); open(p,'w').write(s.replace(a,b))\nEOF" })).toBe('script-edit')
    expect(kindOf('Bash', { command: "sed -i '' 's/a/b/' x.ts && cargo test" })).toBe('edit-check')
    expect(kindOf('Bash', { command: 'git status' })).toBe('bash')
    expect(kindOf('Read', {})).toBe('other')
  })
})

describe('which steps were avoidable', () => {
  test('a check alone right after edits', () => {
    const before = step(3, [edit, edit])
    expect(missed(before, step(4, [bash('npm test')]), bash('npm test'), true)).toBe('check-alone')
  })

  test('not when the check came with the edits, or after a failed edit, or in another turn', () => {
    expect(missed(step(3, [edit]), step(4, [edit, bash('npm test')]), bash('npm test'), true)).toBeUndefined()
    expect(missed(step(3, [edit], { ok: [false] }), step(4, [bash('npm test')]), bash('npm test'), true)).toBeUndefined()
    expect(missed(step(3, [edit], { turnId: 't0' }), step(4, [bash('npm test')]), bash('npm test'), true)).toBeUndefined()
    expect(missed(step(2, [edit]), step(4, [bash('npm test')]), bash('npm test'), true)).toBeUndefined()
  })

  test('one edit per request, twice', () => {
    expect(missed(step(3, [edit]), step(4, [edit]), edit, true)).toBe('edit-alone')
    expect(missed(step(3, [edit, edit]), step(4, [edit]), edit, true)).toBeUndefined()
  })

  test('the same command again, or a second sleep', () => {
    expect(missed(step(3, [bash('git  status')]), step(4, [bash('git status')]), bash('git status'), true)).toBe('repeat')
    expect(missed(step(3, [bash('sleep 30; tail -3 log')]), step(4, [bash('sleep 60; tail log')]), bash('sleep 60; tail log'), true)).toBe('repeat')
    expect(missed(step(3, [bash('git status')]), step(4, [bash('git diff')]), bash('git diff'), true)).toBeUndefined()
  })

  test('a script that rewrites a file, only where run_cell is there to use', () => {
    const script = bash("python3 - <<'EOF'\np='a.ts'; s=open(p).read()\ns=s.replace('x','y'); open(p,'w').write(s)\nEOF")
    expect(missed(undefined, step(0, [script]), script, true)).toBe('script-edit')
    expect(missed(undefined, step(0, [script]), script, false)).toBeUndefined()
    const created = bash("cat > notes.md <<'EOF'\nhello\nEOF")
    expect(missed(undefined, step(0, [created]), created, true)).toBeUndefined()
  })

  test('a script in scratch space is no edit around the Edit tool: nothing there to diff or rewind', () => {
    const S = '/tmp/claude-1000/home-a-proj/abc/scratch'
    const scratch = bash(`cd ${S}; cat > fix.py <<'EOF'\ns=open(p).read().replace(a,b); open(p,'w').write(s)\nEOF\npython3 fix.py`)
    expect(missed(undefined, step(0, [scratch]), scratch, true)).toBeUndefined()
    expect(inTemp(`S=${S}; python3 - > $S/out.json <<'EOF'\nopen("$S/a.py","w")\nEOF`)).toBe(true)
    expect(inTemp(`python3 ${S}/fix.py && cat ${S}/out.txt`)).toBe(true)
    // A script kept in /tmp that rewrites a file of the project is one.
    const project = bash("cat > /tmp/fix.py <<'EOF'\ns=open('src/a.py').read().replace(a,b); open('src/a.py','w').write(s)\nEOF\npython3 /tmp/fix.py")
    expect(missed(undefined, step(0, [project]), project, true)).toBe('script-edit')
    expect(inTemp(`cd ${S} && sed -i '' s/a/b/ /home/a/proj/src/x.ts`)).toBe(false)
    expect(inTemp(`cd ${S} && sed -i '' s/a/b/ ~/proj/src/x.ts`)).toBe(false)
    expect(inTemp("cd /home/a/proj && python3 - <<'EOF'\nopen('a.py','w')\nEOF")).toBe(false)
  })
})

test('notes come first in full, then short, spaced out and capped', () => {
  const b = new Budget()
  expect(b.take('check-alone', 1)).toBe('full')
  expect(b.take('check-alone', 5)).toBeUndefined()
  expect(b.take('check-alone', 13)).toBe('short')
  expect(b.take('check-alone', 25)).toBe('short')
  expect(b.take('check-alone', 37)).toBe('short')
  expect(b.take('check-alone', 49)).toBeUndefined()
  expect(b.take('repeat', 49)).toBe('full')
})

test('a note says what the request re-read and how to save it', () => {
  const cost = costOf(step(4, [bash('npm test')]))
  expect(cost).toBe('400k tokens, ≈$0.08, 4 s')
  expect(noteFor('check-alone', 'full', cost, true).includes('run_cell')).toBe(true)
  expect(noteFor('check-alone', 'full', cost, false).includes('run_cell')).toBe(false)
  expect(noteFor('check-alone', 'short', cost, true).includes(cost)).toBe(true)
})

/** One model request through the hooks, answered beneath them with these calls. */
async function request($: Engine, index: number, toolUses: { name: string; input: unknown }[]) {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 10 + index })
  for await (const _ of s) {
    // the chunks are not what is tested
  }
  return s.result
}

function engine(on: Parameters<TestBody>[1], queue: { name: string; input: unknown }[][]) {
  mock.clock(on, { now: NOW })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: queue.shift() ?? [],
      stopReason: 'tool_use' as const,
      usage: { input_tokens: 20, output_tokens: 80, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 2_000, model: 'claude-opus-5-5' },
    }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/repo/a.ts', oldString: 'a', newString: 'b' } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
}

test('the check that ran alone after edits carries the note, once in full', async ($, on) => {
  const edits = [{ name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } }]
  const check = [{ name: 'Bash', input: { command: 'npm test' } }]
  engine(on, [edits, check, edits, check])
  await request($, 0, edits)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_1', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await request($, 1, check)
  const first = await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_2', command: 'npm test' })
  expect(first.context?.some(c => c.startsWith('cells: this check ran in a model request of its own'))).toBe(true)
  expect(first.context?.some(c => c.includes('400k tokens'))).toBe(true)
  await request($, 2, edits)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_3', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await request($, 3, check)
  const second = await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_4', command: 'npm test' })
  expect(second.context ?? []).toEqual([])
})

test('notes can be switched off', { options: { nudges: false } }, async ($, on) => {
  const edits = [{ name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } }]
  const check = [{ name: 'Bash', input: { command: 'npm test' } }]
  engine(on, [edits, check])
  await request($, 0, edits)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_1', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await request($, 1, check)
  const r = await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_2', command: 'npm test' })
  expect(r.context ?? []).toEqual([])
})
