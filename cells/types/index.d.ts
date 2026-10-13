export type CellsCallState = 'running' | 'ok' | 'failed' | 'refused'

/** One tool call a cell made, as its row draws. */
export type CellsCall = {
  tool: string
  label: string
  state: CellsCallState
  startedAt: number
  ms?: number
  note?: string
}

/** A cell while it runs and after: what the transcript row draws. */
export type CellsLive = {
  startedAt: number
  /** The program it runs: as sent, or as a fix or repair made it. */
  code?: string
  endedAt?: number
  calls: CellsCall[]
  error?: string
  /** Runs on after its tool call ended: asked for, or the person sent a prompt while it ran. */
  background?: boolean
  /** The person interrupted it: no call after that one ran. */
  stopped?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    cells: {
      /** By the tool_use_id of the run_cell call. */
      live: Record<string, CellsLive>
    }
  }
}
