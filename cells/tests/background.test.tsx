import { expect, test } from 'claude-code/testing'

import { stateOf } from '../hooks/view'

// A cell's run needs the sandboxed runner, a real process the test host does not start;
// running in the background is checked in a live session (pilot notes).

test('the card names a cell that runs on in the background, and one the person stopped', () => {
  expect(stateOf({ startedAt: 0, calls: [], background: true }, false)).toBe('background')
  expect(stateOf({ startedAt: 0, calls: [], endedAt: 5 }, false)).toBe('ran')
  expect(stateOf({ startedAt: 0, calls: [], stopped: true }, false)).toBe('stopped')
  expect(stateOf({ startedAt: 0, calls: [], stopped: true, background: true }, false)).toBe('stopped')
})
