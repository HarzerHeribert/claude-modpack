// /mods: which of the pack's mods are loaded, and a button on each to turn it off or on.

import type { BoxProps, ButtonProps, ConfigRow, ElementConstructor, RenderElement, TextProps } from 'claude-code'

export type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

const MARKETPLACE = 'HarzerHeribert/claude-modpack'

const FOLDER = "loaded from a folder: its `enabled` setting is in your settings' pluginConfigs"

export const MODS = [
  ['statusline', 'one line under the prompt: model, context, plan use'],
  ['smart-compact', 'keeps the prompt cache warm or compacts before it expires'],
  ['delegate', 'hands a task to a cheaper worker model and checks its work'],
  ['cells', 'several edits and their check in one step'],
  ['eta', 'a percentage and finish time for long-running jobs'],
  ['seek', 'has Claude look around your code in few, lean steps'],
  ['route', 'sends feature and test work to delegate\'s worker (Jev or ScaleDown; off until you turn it on)'],
] as const

export type ModRow = {
  name: string
  does: string
  state: 'on' | 'off' | 'not installed'
  /** The key to flip and the value to set; absent when not installed or locked. */
  flip?: { key: string; value: boolean }
  install?: string
  /** Loaded without /config rows (a folder): no button; its setting lives in pluginConfigs. */
  folder?: boolean
}

/** The mods seen through commands, tool names (folder-loaded plugins have no /config rows). */
export function loadedMods(commands: readonly { plugin?: string }[], tools: readonly { name: string }[]): Set<string> {
  const out = new Set<string>()
  for (const [name] of MODS) {
    if (commands.some(c => c.plugin === name) || tools.some(t => t.name.startsWith(`mcp__${name}__`))) out.add(name)
  }
  return out
}



/** One row per mod of the pack, from the /config rows; `loaded` names mods seen another way (a folder has no rows). */
export function modRows(config: readonly ConfigRow[], loaded: ReadonlySet<string> = new Set()): ModRow[] {
  return MODS.map(([name, does]) => {
    const key = `${name}.enabled`
    const row = config.find(r => r.key === key)
    if (row === undefined) {
      if (config.some(r => r.key.startsWith(`${name}.`))) return { name, does, state: 'on' as const }
      if (loaded.has(name)) return { name, does, state: 'on' as const, folder: true }
      return { name, does, state: 'not installed' as const, install: `/plugin install ${name} --marketplace ${MARKETPLACE}` }
    }
    const on = row.value !== false
    return { name, does, state: on ? ('on' as const) : ('off' as const), ...(row.isLocked ? {} : { flip: { key, value: !on } }) }
  })
}

export function modsText(rows: readonly ModRow[]): string {
  const lines = rows.map(r => `${r.name}: ${r.state} (${r.does})${r.install ? `\n  ${r.install}` : ''}${r.folder ? `\n  ${FOLDER}` : ''}`)
  return `The pack's mods:\n${lines.join('\n')}\n/mods opens a pane where each installed one turns on or off.`
}

export function modsPane(el: Elements, rows: readonly ModRow[], onFlip: (key: string, value: boolean) => void): RenderElement {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {rows.map(r => (
        <Box key={r.name} flexDirection="column" borderStyle="round" borderColor={r.state === 'on' ? 'claude' : 'subtle'} paddingX={1}>
          <Box>
            <Text bold color={r.state === 'on' ? 'claude' : undefined} dimColor={r.state !== 'on'}>{r.name}</Text>
            <Text dimColor>{`  ${r.state}`}</Text>
          </Box>
          <Text dimColor>{r.does}</Text>
          {r.folder === true && <Text dimColor>{FOLDER}</Text>}
          {r.install !== undefined && <Text dimColor>{r.install}</Text>}
          {r.flip !== undefined && (
            <Button key={`toggle-${r.name}`} plain label={r.state === 'on' ? 'turn off' : 'turn on'} onPress={() => onFlip((r.flip as { key: string }).key, (r.flip as { value: boolean }).value)} />
          )}
        </Box>
      ))}
    </Box>
  )
}
