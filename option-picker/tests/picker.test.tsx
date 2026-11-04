import { expect, test } from 'claude-code/testing'

import { findOptions, toLabel } from '../hooks/parse'

const BAND = {
  plugin: 'option-picker',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const REPLY = `Here are some directions you could pick from:

1. **Ship Track** — a pane that follows your work to the live site.
2. **Tell Detector**: flags AI-looking design.
   It reads every edit.
3. Option Picker. Chips above the prompt.

Which ones do you want?`

test('reads a numbered menu into short labels', () => {
  expect(findOptions(REPLY)).toEqual([
    { n: 1, label: 'Ship Track' },
    { n: 2, label: 'Tell Detector' },
    { n: 3, label: 'Option Picker' },
  ])
  expect(toLabel('Use `wrangler` to deploy: it is quick')).toBe('Use wrangler to deploy')
})

test('ignores numbered steps that offer no choice', () => {
  expect(findOptions('Done.\n\n1. Installed it\n2. Ran the build\n3. Pushed')).toEqual([])
  expect(findOptions('Pick one:\n\n1. Only option')).toEqual([])
})

test('picking chips fills the prompt with "Do 1, 3"', async ($, on) => {
  let filled = ''
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  await $.turn.complete({ answer: REPLY, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'opt-2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'opt-3' })
  await ui.press({ key: 'opt-1' })
  await ui.press({ key: 'use' })
  expect(filled).toBe('Do 1, 3')
  expect(await ui.find({ key: 'opt-1' })).toBeUndefined()
  await ui.unmount()
})
