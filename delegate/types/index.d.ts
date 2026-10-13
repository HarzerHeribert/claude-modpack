/** One tool call a worker made, as the card and the pane list it. */
export type DelegateAction = {
  tool: string
  label: string
  state: 'running' | 'ok' | 'failed'
  startedAt: number
  ms?: number
}

/** One hand-off as it draws: live while its worker runs, then its outcome. */
export type DelegateJob = {
  n: number
  toolUseId: string
  agentId: string
  mode: 'explore' | 'edit'
  task: string
  model: string
  reused: boolean
  /** References the language server (or a text search) found for the focus. */
  reach: number
  startedAt: number
  endedAt?: number
  state: 'running' | 'reported' | 'failed'
  requests: number
  usd: number
  /** The same steps on the main model, estimated when the report arrives. */
  aloneUsd?: number
  actions: DelegateAction[]
  files?: string[]
  added?: number
  removed?: number
  check?: { command: string; exit: number }
  verdict?: string
  /** The worker's report, as it reached the main model. */
  report?: string
}

declare module 'claude-code' {
  interface PluginState {
    delegate: {
      /** This session's hand-offs, oldest first. */
      jobs: DelegateJob[]
      /** The hand-off the pane shows open, by its tool_use_id. */
      watching: string | null
    }
  }
}
