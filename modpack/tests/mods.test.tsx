import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const row = (key: string, value: unknown, isLocked = false) => ({ key, label: key, kind: 'toggle', value, provider: { kind: 'plugin', name: key.split('.')[0] }, isLocked })

const ROWS = [
  row('statusline.enabled', true),
  row('statusline.placement', 'line'),
  row('smart-compact.enabled', true),
  row('delegate.enabled', false),
  row('lsp-plus.enabled', true, true),
  row('cells.enabled', true),
]

function host(on: On) {
  const sets: { key: string; value: unknown }[] = []
  on('config.list', () => ({ value: ROWS as never }))
  on('config.set', (_$, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.open', () => ({ value: { isOpen: true } as never }))
  return sets
}

test('/mods lists all six with on, off or not installed', async ($, on) => {
  host(on)
  const r = (await $.command.run({ command: 'mods' } as never)) as { text?: string }
  const t = String(r.text)
  expect(t).toContain('statusline: on')
  expect(t).toContain('smart-compact: on')
  expect(t).toContain('delegate: off')
  expect(t).toContain('lsp-plus: on')
  expect(t).toContain('cells: on')
  expect(t).toContain('eta: not installed')
  expect(t).toContain('/plugin install eta --marketplace HarzerHeribert/claude-modpack')
  expect(t).not.toContain('/plugin install cells')
})

test('a row\'s button flips its enabled setting; a locked row has none', async ($, on) => {
  const sets = host(on)
  const ui = await $.ui.mount({ plugin: 'modpack', surface: 'terminal', component: 'Pane', requestId: 'mods', props: { bodyColumns: 80 }, viewport: { columns: 100, rows: 40 } } as never)
  expect(await ui.find({ type: 'Button', key: 'toggle-lsp-plus' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'toggle-eta' })).toBeUndefined()
  await ui.press({ key: 'toggle-delegate' })
  await ui.press({ key: 'toggle-cells' })
  expect(sets).toEqual([{ key: 'delegate.enabled', value: true }, { key: 'cells.enabled', value: false }])
  await ui.unmount()
})

test('a mod with no config rows is on, from a folder, when a tool or command shows it', async ($, on) => {
  on('config.list', () => ({ value: ROWS.filter(r => !r.key.startsWith('cells.') && !r.key.startsWith('lsp-plus.')) as never }))
  on('tool.list', () => ({ value: [{ name: 'mcp__cells__run_cell' }] as never }))
  on('command.list', () => ({ value: [{ name: 'x', plugin: 'lsp-plus' }] as never }))
  const t = String(((await $.command.run({ command: 'mods' } as never)) as { text?: string }).text)
  expect(t).toContain('cells: on')
  expect(t).toContain('lsp-plus: on')
  expect(t).toContain('loaded from a folder')
  expect(t).not.toContain('/plugin install cells')
  expect(t).not.toContain('/plugin install lsp-plus')
  expect(t).toContain('eta: not installed')
  const ui = await $.ui.mount({ plugin: 'modpack', surface: 'terminal', component: 'Pane', requestId: 'mods', props: { bodyColumns: 80 }, viewport: { columns: 100, rows: 40 } } as never)
  expect(await ui.find({ type: 'Button', key: 'toggle-cells' })).toBeUndefined()
  await ui.unmount()
})
