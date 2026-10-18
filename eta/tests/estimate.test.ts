import { describe as group, expect, test } from 'claude-code/testing'

import { bar, clock, commandLabel, describe, estimate, feed } from '../hooks/estimate'
import type { Job } from '../types'

const MIN = 60_000

function job(over: Partial<Job> = {}): Job {
  return { id: 'j', label: 'job', source: 'claude', startedAt: 0, offset: 0, carry: '', done: 0, samples: [[0, 0]], status: 'running', ...over }
}

group('feed', () => {
  test('counts done lines against the total, a partial line waiting for its end', () => {
    let j = job({ donePattern: '^  \\S+ (RESOLVED|no) ', total: 90 })
    j = feed(j, '30 tasks\n  a-1 RESOLVED req=7\n  b-1 no      req=9\n  c-1 RESOL', MIN)
    expect(j.done).toBe(2)
    j = feed(j, 'VED req=3\n', 2 * MIN)
    expect(j.done).toBe(3)
    expect(j.frac).toBe(3 / 90)
  })

  test('reads a tqdm bar redrawn with carriage returns', () => {
    const j = feed(job(), ' 42%|████      | 42/100 [00:10<00:14]\r 43%|████      | 43/100 [00:10<00:13]', MIN)
    expect(j.frac).toBe(0.43)
  })

  test('reads pytest percentages and "step n of m"', () => {
    expect(feed(job(), 'tests/test_a.py ....  [ 45%]\n', MIN).frac).toBe(0.45)
    expect(feed(job(), 'Step 3 of 10: compiling\n', MIN).frac).toBe(0.3)
  })

  test('a pattern of Claude’s reads (done)(total)', () => {
    expect(feed(job({ progressPattern: 'shard (\\d+)\\D+(\\d+)' }), 'shard 7 finished, 28 shards\n', MIN).frac).toBe(0.25)
  })

  test('the last unit finishes the job', () => {
    const j = feed(job({ donePattern: 'ok', total: 2 }), 'ok\nok\n', 5 * MIN)
    expect(j.status).toBe('completed')
    expect(j.endedAt).toBe(5 * MIN)
  })
})

group('estimate', () => {
  test('half done in ten minutes finishes ten minutes later', () => {
    const j = feed(job(), '[5/10]\n', 10 * MIN)
    expect(estimate(j, 10 * MIN).at).toBe(20 * MIN)
  })

  test('before progress, Claude’s guess stands', () => {
    const e = estimate(job({ expectedMs: 30 * MIN }), 5 * MIN)
    expect(e.basis).toBe('guess')
    expect(e.at).toBe(30 * MIN)
  })

  test('progress that stops moving says so', () => {
    let j = job()
    for (let i = 1; i <= 4; i++) j = feed(j, `[${i}/10]\n`, i * MIN)
    expect(estimate(j, 5 * MIN).stalledMs).toBe(undefined)
    expect(estimate(j, 12 * MIN).stalledMs).toBe(8 * MIN)
  })
})

group('describe', () => {
  test('a running job: bar, percent, count, clock time and how long', () => {
    let j = job({ donePattern: 'done', total: 4 })
    j = feed(j, 'done\n', 10 * MIN)
    const d = describe(j, 10 * MIN, 120)
    expect(d.progress).toBe(`${bar(0.25)} 25% 1/4`)
    expect(d.eta.startsWith(`ETA ${clock(40 * MIN, 120)} · in 30m`)).toBe(true)
  })

  test('an ended job says how long it took', () => {
    expect(describe(job({ status: 'completed', endedAt: 72 * MIN }), 80 * MIN, 0).eta).toBe('done in 1h12')
  })

  test('clock times are the person’s', () => {
    expect(clock(0, 120)).toBe('02:00')
    expect(clock(0, -300)).toBe('19:00')
  })
})

group('commandLabel', () => {
  test('names the command that does the work, not the cd and the variables before it', () => {
    expect(commandLabel('cd ~/projects/claude-mods/pilot/delegate-bench && export BENCH_PACK_ROOT=$HOME/x && python3 compact_bench.py run --arms KEEP,COMPACT --reps 3 2>&1 | tail -60'))
      .toStartWith('compact_bench.py run --arms KEEP')
    expect(commandLabel('cd x && BENCH_RESULTS=r.jsonl timeout 900 python3 bench.py run --jobs 4')).toBe('bench.py run --jobs 4')
    expect(commandLabel('npm test')).toBe('npm test')
    expect(commandLabel('python3 -m pytest -q tests')).toBe('python3 -m pytest -q tests')
    expect(commandLabel('cd /tmp/a')).toBe('cd /tmp/a')
    expect(commandLabel('/usr/local/bin/ffmpeg -i in.mov out.gif').startsWith('ffmpeg -i')).toBe(true)
    expect(commandLabel('x '.repeat(60)).length).toBeLessThanOrEqual(48)
  })
})
