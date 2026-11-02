import { describe as group, expect, test } from 'claude-code/testing'

import { mutualWait, pgrepPatterns } from '../hooks/waits'

const sources = (c: string) => pgrepPatterns(c).map(p => p.source)

group('pgrepPatterns', () => {
  test('reads the -f patterns a loop waits on, quoted or bare, among other options', () => {
    expect(sources("until ! pgrep -f 'ANA-009-final.last.md' >/dev/null; do sleep 30; done")).toEqual(['ANA-009-final.last.md'])
    expect(sources("until [ -s a ] && ! pgrep -f 'x.md' >/dev/null && ! pgrep -fl \"y.md\" >/dev/null; do :; done")).toEqual(['x.md', 'y.md'])
    expect(sources('while pgrep -u me -f chk-num.last.md>/dev/null; do sleep 9; done')).toEqual(['chk-num.last.md'])
  })
  test('leaves out counts, lists, one-off checks, pgrep without -f and patterns that name a variable', () => {
    expect(sources('while [ $(pgrep -f "codex exec" | wc -l) -ge 3 ]; do sleep 5; done')).toEqual([])
    expect(sources("until [ \`pgrep -f 'x' | wc -l\` -lt 3 ]; do sleep 5; done")).toEqual([])
    expect(sources("pgrep -f 'codex exec' | wc -l; pgrep -fl 'codex exec' | grep -oE 'x'")).toEqual([])
    expect(sources("pgrep -f 'ANA' >/dev/null && echo running; for f in a; do pgrep -f 'x'; done")).toEqual([])
    expect(sources('until ! pgrep codex; do sleep 5; done')).toEqual([])
    expect(sources("cat > l.sh <<'EOF'\nuntil ! pgrep -f 'fix-ana' >/dev/null; do sleep 30; done\nEOF\nchmod +x l.sh")).toEqual([])
    expect(sources("cat > l.sh <<EOF\nx\nEOF\nuntil ! pgrep -f 'a.md'; do :; done")).toEqual(['a.md'])
    expect(sources('until ! pgrep -f "$PAT"; do sleep 5; done; while pgrep -f $X; do :; done')).toEqual([])
  })
})

group('mutualWait', () => {
  const waiter = "until ! pgrep -f 'chk-(num|lit).last.md' >/dev/null; do sleep 30; done; cat $SP/chk-num.last.md"
  test('two waiters whose patterns find each other', () => {
    expect(mutualWait(waiter, [{ id: 'b1', command: waiter }])).toEqual({ id: 'b1', pattern: 'chk-(num|lit).last.md' })
  })
  test('a waiter on a job that waits on nothing, a command that waits on nothing, a count', () => {
    expect(mutualWait("until ! pgrep -f 'A.last.md'; do sleep 20; done", [{ id: 'b1', command: 'codex exec -o /s/A.last.md' }])).toBe(undefined)
    expect(mutualWait('cat $SP/chk-num.last.md', [{ id: 'b1', command: waiter }])).toBe(undefined)
    expect(mutualWait("while [ $(pgrep -f 'chk-num' | wc -l) -ge 3 ]; do sleep 5; done", [{ id: 'b1', command: waiter }])).toBe(undefined)
  })
})
