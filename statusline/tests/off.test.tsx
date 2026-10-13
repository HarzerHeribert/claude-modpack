import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_700_000_000_000

test('turned off, the statusline draws nothing: the hint and the band fall through', { options: { enabled: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String(e.props.hint)}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const hint = await $.ui.mount({
    plugin: 'statusline',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns: 160, rows: 40 },
  } as never)
  expect((await hint.find({ type: 'Text' }))?.text).toBe('? for shortcuts')
  await hint.unmount()
  const band = await $.ui.mount({
    plugin: 'statusline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    viewport: { columns: 160, rows: 40 },
  } as never)
  expect(await band.drawn()).toMatchObject({ type: 'Box', props: { key: 'engine' } })
  await band.unmount()
})
