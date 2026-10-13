import { describe, expect, mock, test } from 'claude-code/testing'

import { parsePublish, titleOf, upsert } from '../hooks/artifacts'

const NOW = 1_000_000_000
const PUBLISHED = 'Published /w/report/cells-pilot.html at https://claude.ai/artifact/Asfv4vtsuWhwUBQfZeoG46 (Version 2, version id 1791-7fb5) Icon: "chart".'

describe('reading a publish', () => {
  test('the link and the version', () => {
    expect(parsePublish(PUBLISHED)).toEqual({ url: 'https://claude.ai/artifact/Asfv4vtsuWhwUBQfZeoG46', version: 2 })
    expect(parsePublish('Listed 3 artifacts')).toBe(undefined)
  })

  test('the page’s own title, else the call’s, else the file name', () => {
    expect(titleOf('<head><title>Cells Pilot &amp; Results</title>', '/w/a.html', undefined)).toBe('Cells Pilot & Results')
    expect(titleOf(undefined, '/w/a.html', 'Given')).toBe('Given')
    expect(titleOf(undefined, '/w/cells-plan.html', undefined)).toBe('cells-plan')
  })

  test('a new version moves the page to the front', () => {
    const a = { url: 'u1', title: 'one', version: 1 }
    const b = { url: 'u2', title: 'two', version: 1 }
    expect(upsert([a, b], { ...b, version: 2 }).map(x => `${x.url}@${x.version}`)).toEqual(['u2@2', 'u1@1'])
  })
})

const HINT = {
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '⏵⏵ auto mode on · ⧉1 · ← for agents' },
  viewport: { columns: 160, rows: 40 },
}
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  viewport: { columns: 160, rows: 40 },
}

test('a published page becomes a pill that opens a list of links, on the terminal and the desktop app', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', () => ({ value: '<title>Cells Pilot Results</title>' }))
  on('tool.call', { tool: 'Artifact' }, () => ({ result: PUBLISHED, text: PUBLISHED }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.tool.call({ tool: 'Artifact', file_path: '/w/report/cells-pilot.html' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const line = await $.ui.mount({ plugin: 'statusline', surface, ...HINT })
    expect(await line.find({ key: 'artifacts' })).toBeDefined()
    expect(await line.find({ type: 'Text', text: /⧉1/ })).toBe(undefined)
    await line.press({ key: 'artifacts' })
    await line.unmount()

    const band = await $.ui.mount({ plugin: 'statusline', surface, ...BAND })
    expect(await band.find({ type: 'Link', text: 'Cells Pilot Results' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /v2 · just now/ })).toBeDefined()
    await band.press({ key: 'close-artifacts' })
    await band.unmount()
  }
})
