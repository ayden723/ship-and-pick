import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { afterDeploy, look, remember, remembered } from './look'
import { ago, toStages, toSvg } from './stages'

const PANE = 'ship-track'
const TITLE = 'Ship Track'
// Change the tag when the snapshot's fields change.
const snapshot = atom({ plugin: 'ship-track', key: 'snapshot' } as const, null, {
  shape: 'snapshot-1',
})
const isChecking = atom({ plugin: 'ship-track', key: 'isChecking' } as const, false)

const SHIPPING = /\b(git|gh|wrangler)\b|\bnpm run deploy\b|\bpnpm deploy\b/
const DEPLOY = /\bwrangler\s+(pages\s+)?deploy\b|\b(npm|pnpm|yarn)\s+(run\s+)?deploy\b/
const SHIP_PROMPT = 'Commit, push and deploy this, then confirm the live site shows the change.'

async function refresh($: EngineInterface) {
  if (await read($, isChecking)) return

  await update($, isChecking, () => true)
  try {
    const found = await look($)
    await update($, snapshot, () => found)
  } finally {
    await update($, isChecking, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ship-track',
      description: 'Show Ship Track. Add "url <link>" to set the live site, or "deployed" to mark a deploy.',
    })
    await refresh($)
    if ((await read($, snapshot))?.isRepo) {
      void $.ui.open({ id: PANE, title: TITLE })
    }

    return next(e)
  })

  on('command.run', { command: 'ship-track' }, async ($, e) => {
    const cwd = await $.session.cwd()
    const [verb, value] = e.args.trim().split(/\s+/, 2)

    if (verb === 'url' && value && /^https?:\/\//.test(value)) {
      await remember($, cwd, { liveUrl: value })
    } else if (verb === 'deployed') {
      await remember($, cwd, { lastDeployAt: await $.clock.now() })
    } else if (verb) {
      return { text: 'Use /ship-track, /ship-track url https://your-site, or /ship-track deployed.' }
    }

    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    return { text: verb === 'url' ? `Ship Track now checks ${value}.` : 'Ship Track is open.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const command = 'command' in e && typeof e.command === 'string' ? e.command : ''

    // Bookkeeping only: a failure here must never change what the tool did.
    try {
      if ((e.tool === 'Bash' || e.tool === 'PowerShell') && SHIPPING.test(command)) {
        if (DEPLOY.test(command) && ran.deny === undefined && ran.isError !== true) {
          const cwd = await $.session.cwd()
          const output = (ran.result as { stdout?: string } | undefined)?.stdout ?? ''
          await remember($, cwd, afterDeploy(await remembered($, cwd), output, await $.clock.now()))
        }
        void refresh($)
      }
    } catch {
      // The pane refreshes on the next turn anyway.
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      void refresh($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const found = await read($, snapshot)
    const checking = await read($, isChecking)
    const now = await $.clock.now()

    if (!found) {
      return <Text dimColor>Looking at this project…</Text>
    }

    if (!found.isRepo) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>This folder isn't a git repo, so there's nothing to track yet.</Text>
          <Button key="refresh" dimColor label="Check again" onPress={() => refresh($)} />
        </Box>
      )
    }

    const stages = toStages(found, now)
    const fill = (text: string) => $.prompt.fill({ text, mode: 'replace' })

    return (
      <Box flexDirection="column" gap={1}>
        {e.surface !== 'terminal' && 'Svg' in elements ? (
          <elements.Svg
            source={toSvg(stages)}
            alt={stages.map(stage => `${stage.name}: ${stage.note}`).join('. ')}
          />
        ) : (
          <Box flexDirection="column">
            {stages.map(stage => (
              <Text
                color={stage.state === 'done' ? 'success' : stage.state === 'waiting' ? 'warning' : stage.state === 'problem' ? 'error' : 'inactive'}
              >
                {stage.state === 'done' ? '●' : '○'} {stage.name}  <Text dimColor>{stage.note}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          {found.lastCommit && (
            <Text wrap="truncate-end">
              <Text dimColor>Last commit </Text>
              {found.lastCommit.subject}
            </Text>
          )}
          {found.pr && (
            <Text wrap="truncate-end">
              <Text dimColor>PR #{found.pr.number} </Text>
              {found.pr.state.toLowerCase()} · {found.pr.url}
            </Text>
          )}
          <Text wrap="truncate-end">
            <Text dimColor>Live </Text>
            {found.liveUrl ?? 'not set'}
          </Text>
          <Text dimColor size="footnote">
            {checking ? 'Checking…' : `Checked ${ago(found.checkedAt, now)} on ${found.branch}`}
          </Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {stages.some(stage => stage.state === 'waiting') && (
            <Button key="ship" variant="primary" label="Ship it" onPress={() => fill(SHIP_PROMPT)} />
          )}
          {!found.liveUrl && (
            <Button key="url" label="Set live URL" onPress={() => fill('/ship-track url https://')} />
          )}
          <Button key="refresh" dimColor label="Refresh" onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
