// Bench only (compact_bench.py, arm PREP): answers a compaction of the main conversation as smart-compact answers its
// own with a summary written ahead. PREP_SUMMARY_FILE holds the first message as smart-compact builds it (SUMMARY_HEAD
// and the summary); the messages after the last one on the person's side, which the summary's fork does not read in a
// session, stay as they are. Without the variable it stands aside.

import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.compact', async ($, e, next) => {
    const path = await $.env.get('PREP_SUMMARY_FILE')
    if (path === undefined || path === '' || e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    const text = await $.fs.read(path)
    let last = e.messages.length - 1
    while (last >= 0 && e.messages[last]?.role !== 'user') last -= 1
    if (typeof text !== 'string' || last < 0 || last + 1 >= e.messages.length) return next(e)
    return { messages: [{ role: 'user' as const, text, toolUses: [] }, ...e.messages.slice(last + 1)] }
  })
}
