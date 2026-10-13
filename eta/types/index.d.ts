/** A job whose progress is read from a file it writes: a background task's output or a log. */
export type Job = {
  id: string
  label: string
  source: 'background' | 'claude'
  file?: string
  /** Each output line this matches counts one unit done. */
  donePattern?: string
  /** A progress line: groups (done)(total), or one group holding a percentage. */
  progressPattern?: string
  finishedPattern?: string
  total?: number
  /** Claude's own guess at the whole job's duration, used until progress is measurable. */
  expectedMs?: number
  startedAt: number
  offset: number
  carry: string
  done: number
  frac?: number
  /** [time, fraction done], oldest first; the first may be the job's start at 0. */
  samples: [number, number][]
  lastProgressAt?: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    eta: {
      /** The jobs shown: running, finishing (their beat), or failed and not yet seen. */
      jobs: Job[]
      /** Failed jobs the person has seen, by writing again since; until then a failure keeps its red row. */
      seen: string[]
      /** The person's offset from UTC in minutes, for clock times; null until read. */
      tzOffsetMin: number | null
    }
  }
}
