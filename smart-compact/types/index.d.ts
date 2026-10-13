export type SmartCompactPhase = 'none' | 'warm' | 'acting' | 'cold' | 'compacted'

export type SmartCompactPlan = 'keepalive' | 'compact' | 'lapse' | 'none'

/** The main thread's prompt cache, as the controller tracks it. */
export type SmartCompactCache = {
  phase: SmartCompactPhase
  /** API id of the model that answered last, e.g. `claude-opus-5-5`. */
  model?: string
  /** Prompt tokens of the main thread's last request: what a lapse re-writes. */
  contextTokens?: number
  /** When the last request that read or wrote the prefix started (ms). */
  warmAt?: number
  ttlMs: number
  ttlSource: string
  /** What happens at `actAt`, and why. */
  plan: SmartCompactPlan
  why: string
  actAt?: number
  /** When the session last went idle, and what keeping it warm has cost since. */
  idleSince?: number
  keptAlive: number
  keptAliveUsd: number
  /**
   * What lapsing would have cost and what the mod spent instead, credited to
   * `savedUsd` only once the person comes back and the next request runs.
   */
  credit?: { lapseUsd: number; spentUsd: number }
  /** This session's savings, net of keep-alives and compactions. */
  savedUsd: number
  /** `/cache pause`: draw, but never act. */
  isPaused: boolean
}

export type SmartCompactLimit = { kind: string; percentUsed: number; resetsAt?: number }

/** What the controller reads of the session beside its cache. */
export type SmartCompactWorld = {
  isWorking: boolean
  /** Off reads as "never compact for me". */
  isAutoCompactOn: boolean
  /** The plan's windows: a subscription's cache lives an hour, an API key's five minutes. */
  limits: SmartCompactLimit[]
}

declare module 'claude-code' {
  interface PluginState {
    'smart-compact': {
      cache: SmartCompactCache
      world: SmartCompactWorld
    }
  }
}
