/** How a part reads: the line's palette, from the person's theme. */
export type StatuslineTone = 'accent' | 'good' | 'text' | 'label' | 'faint' | 'warn' | 'alert'

/** Text in a tone; with `blink`, it blinks between those two times (ms since the epoch). */
export type StatuslineText = { text: string; tone: StatuslineTone; blink?: { from: number; to: number } }

/** The time left until `until` (ms since the epoch), as `8:00`, `44m` or `2h14`; warn-toned in its last `warnMs`. */
export type StatuslineCountdown = { until: number; tone: StatuslineTone; prefix?: string; warnMs?: number }

/** A spinner that turns while it is shown. */
export type StatuslineSpinner = { spin: true; tone: StatuslineTone }

export type StatuslinePart = StatuslineText | StatuslineCountdown | StatuslineSpinner

/**
 * A segment another mod puts on the line. `id` is the mod's and stays the same
 * (`smart-compact:ready`). A lower `priority` stays longer on a narrow line: the
 * line's own are the context 1, the 5-hour window 2, the 7-day window 3, a spend
 * cap 4, the model 5. `short` is what it says before it is dropped. `side: 'end'`
 * (the default) sits at the right edge, where the eye lands; `'start'` before the model.
 * `calm` marks a routine state: drawn where the line has room for everything, left out
 * where the host shows the essentials itself (the desktop app).
 */
export type StatuslineSegment = {
  id: string
  priority: number
  parts: StatuslinePart[]
  short?: StatuslinePart[]
  side?: 'start' | 'end'
  calm?: boolean
}

/** What other mods call: `$.statusline.set(segment)`, `$.statusline.remove({ id })`. */
export type Statusline = {
  /** Puts the segment on the line, replacing the one with its id. */
  set: (segment: StatuslineSegment) => Promise<{ isShown: boolean }>
  /** Takes the segment with this id off the line. */
  remove: (args: { id: string }) => Promise<{ isRemoved: boolean }>
}

export type StatuslineLimit = { kind: string; percentUsed: number; resetsAt?: number }

/** What the line draws of the session itself. */
export type StatuslineWorld = {
  isWorking: boolean
  /** The main loop's model: the last response's, else the session's. */
  model?: string
  /** The effort of the last turn, or the configured one before any. */
  effort?: string
  /** Prompt tokens of the main thread's last request. */
  contextTokens?: number
  window: number
  /** Where the engine auto-compacts; absent when it does not. */
  autoCompactAt?: number
  limits: StatuslineLimit[]
}

/** A page this session published with the Artifact tool, as the line's pill lists it. */
export type StatuslineArtifact = {
  url: string
  title: string
  version: number
  /** When it was last published; absent for one found in the transcript after a reload. */
  updatedAt?: number
}

declare module 'claude-code' {
  interface EngineInterface {
    statusline: Statusline
  }
  interface PluginState {
    statusline: {
      /** What other mods put on the line, by id. */
      segments: Record<string, StatuslineSegment>
      world: StatuslineWorld
      /** Newest first. */
      artifacts: StatuslineArtifact[]
      /** The artifacts list is open in the band above the prompt. */
      isArtifactsOpen: boolean
    }
  }
}
