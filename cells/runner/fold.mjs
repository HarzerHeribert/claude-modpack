// Folds long command output before a model reads it: passing tests, build
// chatter and repeated lines collapse into one count each; a line that looks
// like a failure is never dropped. Shared by the cells runner and the mod.

const PASSING = [
  /^\s*test\s.+\s\.\.\.\s*ok\s*$/, // cargo test, unittest -v
  /^\s*ok\s+\d+\b/, // TAP
  /\bPASSED\b/, // pytest -v
  /^\s*✓\s/, // jest, vitest
  /^\s*[\w./\\-]+\.py\s+[.sSxX]+\s*(\[\s*\d+%\])?\s*$/, // pytest progress dots
]

const CHATTER =
  /^\s*(Compiling|Checking|Downloaded|Downloading|Fresh|Blocking|Updating|Locking|Adding|Installing|Collecting|Requirement already satisfied|Building|Built|Resolved|Prepared|Audited)\b/

const FAILURE =
  /(error|fail|panic|traceback|exception|warning:|assert|not ok|✗|✕|^E\s|^\s*E\s{2,}|exit code [1-9])/i

export const FOLD_ABOVE = 8_000

export function fold(text, above = FOLD_ABOVE) {
  if (typeof text !== 'string' || text.length < above) return text

  const kept = []
  let passing = 0
  let chatter = 0
  let repeated = 0
  let previous

  for (const line of text.split('\n')) {
    if (FAILURE.test(line)) {
      kept.push(line)
      previous = line
    } else if (PASSING.some(p => p.test(line))) {
      passing += 1
    } else if (CHATTER.test(line)) {
      chatter += 1
    } else if (line === previous && line.trim() !== '') {
      repeated += 1
    } else {
      kept.push(line)
      previous = line
    }
  }

  const said = [
    passing && `${passing} passing-test lines`,
    chatter && `${chatter} build lines`,
    repeated && `${repeated} repeated lines`,
  ].filter(Boolean)

  if (said.length === 0) return text
  return `[folded ${said.join(', ')}; every failure line kept]\n${kept.join('\n')}`
}

/** A long text's head and tail, with one line saying what was cut. */
export function cut(text, room, hint = '') {
  if (text.length <= room) return text
  const head = Math.floor(room * 0.65)
  const tail = room - head
  const gone = text.length - head - tail
  return `${text.slice(0, head)}\n… ${gone} chars cut${hint} …\n${text.slice(-tail)}`
}
