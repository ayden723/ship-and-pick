import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { findOptions } from './parse'

// Change the tag when an option's fields change.
const options = atom({ plugin: 'option-picker', key: 'options' } as const, [], {
  shape: 'options-1',
})
const picked = atom({ plugin: 'option-picker', key: 'picked' } as const, [])

async function clear($: EngineInterface) {
  await update($, options, () => [])
  await update($, picked, () => [])
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await update($, options, () => findOptions(e.answer))
      await update($, picked, () => [])
    }

    return next(e)
  })

  // A failed clear must never hold back what the person sent.
  on('prompt.submit', async ($, e, next) => {
    await clear($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, options)

    if (e.props.hasSurvey || list.length === 0) {
      return next(e)
    }

    const chosen = await read($, picked)
    const { Box, Button, Text } = $.ui.resolve(e)
    const reply = `Do ${[...chosen].sort((a, b) => a - b).join(', ')}`
    const toggle = (n: number) =>
      update($, picked, now => (now.includes(n) ? now.filter(one => one !== n) : [...now, n]))
    const use = async () => {
      await $.prompt.fill({ text: reply, mode: 'insert' })
      await clear($)
    }
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" gap={1} paddingY={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor size="footnote">
              Pick from the last reply{list.length > 1 ? ` · press 1–${Math.min(list.length, 9)} in an empty prompt` : ''}
            </Text>
            <Button key="dismiss" role="dismiss" plain dimColor label="Dismiss" onPress={() => clear($)} />
          </Box>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {list.map(option => (
              <Button
                key={`opt-${option.n}`}
                hotkey={option.n <= 9 ? String(option.n) : undefined}
                variant={chosen.includes(option.n) ? 'primary' : 'secondary'}
                onPress={() => toggle(option.n)}
              >
                {chosen.includes(option.n) ? '✓ ' : ''}
                {option.n}. {option.label}
              </Button>
            ))}
          </Box>
          <Box flexDirection="row" gap={1}>
            {chosen.length > 0 && <Button key="use" variant="primary" label={`Use “${reply}”`} onPress={use} />}
            {chosen.length < list.length && (
              <Button
                key="all"
                dimColor
                label="Select all"
                onPress={() => update($, picked, () => list.map(option => option.n))}
              />
            )}
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
