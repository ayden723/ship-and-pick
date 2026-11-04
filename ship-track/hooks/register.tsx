import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { cleanUrl, learnSubdomain } from './detect'
import { afterDeploy, commandFolder, guessAgain, look, remember, remembered, repoRoot } from './look'
import { ago, toStages, toSvg } from './stages'

const PANE = 'ship-track'
const TITLE = 'Ship Track'
// Change the tag when the snapshot's fields change.
const snapshot = atom({ plugin: 'ship-track', key: 'snapshot' } as const, null, {
  shape: 'snapshot-3',
})
const isChecking = atom({ plugin: 'ship-track', key: 'isChecking' } as const, false)
const folder = atom({ plugin: 'ship-track', key: 'folder' } as const, null as string | null)

const SHIPPING = /\b(git|gh|wrangler)\b|\bnpm run deploy\b|\bpnpm deploy\b/
const DEPLOY = /\bwrangler\s+(pages\s+)?deploy\b|\b(npm|pnpm|yarn)\s+(run\s+)?deploy\b/
const SHIP_PROMPT = 'Commit, push and deploy this, then confirm the live site shows the change.'

// Points the pane at the repo a command shipped from, or back at the
// session's own repo when that is the one.
async function follow($: EngineInterface, dir: string) {
  const [top, home] = await Promise.all([repoRoot($, dir), repoRoot($, await $.session.cwd())])
  if (!top) return

  await update($, folder, () => (top === home ? null : top))
}

async function goHome($: EngineInterface) {
  await update($, folder, () => null)
  await refresh($)
}

async function refresh($: EngineInterface) {
  if (await read($, isChecking)) return

  await update($, isChecking, () => true)
  try {
    const found = await look($, await read($, folder))
    await update($, snapshot, () => found)
  } finally {
    await update($, isChecking, () => false)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ship-track',
      description: 'Show Ship Track. Add "url <link>" to set the live site ("url" alone finds it again), "deployed" to mark a deploy, or "here" to track this folder again.',
    })
    // The row above the prompt shows when something waits; the full pane
    // opens only with /ship-track.
    await refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const found = await read($, snapshot)
    if (e.props.hasSurvey || e.props.isWorking || !found?.isRepo) return next(e)

    const now = await $.clock.now()
    const stuck = toStages(found, now).filter(stage => stage.state === 'waiting' || stage.state === 'problem')
    if (stuck.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
        <Text wrap="truncate-end">
          <Text weight="semibold">{found.repo}</Text>
          {stuck.map(stage => (
            <Text color={stage.state === 'problem' ? 'error' : 'warning'}>{'  ·  '}{stage.note}</Text>
          ))}
        </Text>
        {stuck.some(stage => stage.state === 'waiting') && (
          <Button key="ship" variant="primary" label="Ship it" onPress={() => $.prompt.fill({ text: SHIP_PROMPT, mode: 'replace' })} />
        )}
        <Button key="details" dimColor label="Details" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })

  on('command.run', { command: 'ship-track' }, async ($, e) => {
    const cwd = (await read($, folder)) ?? (await $.session.cwd())
    const [verb, value] = e.args.trim().split(/\s+/, 2)

    const url = cleanUrl(value)
    if (verb === 'url' && url) {
      await remember($, cwd, { liveUrl: url, isGuessed: false })
      await learnSubdomain($, url)
    } else if (verb === 'url') {
      // No link, or one with no site in it: forget it and find the site again
      await remember($, cwd, { liveUrl: null, isGuessed: false })
      guessAgain(cwd)
    } else if (verb === 'deployed') {
      await remember($, cwd, { lastDeployAt: await $.clock.now() })
    } else if (verb === 'here') {
      await goHome($)
    } else if (verb) {
      return { text: 'Use /ship-track, /ship-track url https://your-site, /ship-track url (to find it again), /ship-track deployed, or /ship-track here.' }
    }

    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    if (verb === 'url' && !url) {
      const found = (await read($, snapshot))?.liveUrl
      return { text: found ? `Ship Track found the live site: ${found}` : "Ship Track couldn't find the live site. Use /ship-track url https://your-site to set it." }
    }

    return { text: verb === 'url' ? `Ship Track now checks ${url}.` : 'Ship Track is open.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const command = 'command' in e && typeof e.command === 'string' ? e.command : ''

    // Bookkeeping only: a failure here must never change what the tool did.
    try {
      if (e.tool === 'Bash' || e.tool === 'PowerShell') {
        const output = (ran.result as { stdout?: string } | undefined)?.stdout ?? ''
        await learnSubdomain($, `${command}
${output}`)
      }
      if ((e.tool === 'Bash' || e.tool === 'PowerShell') && SHIPPING.test(command)) {
        const dir = commandFolder(command)
        if (dir) await follow($, dir)
        if (DEPLOY.test(command) && ran.deny === undefined && ran.isError !== true) {
          const cwd = (await read($, folder)) ?? (await $.session.cwd())
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
    const following = (await read($, folder)) !== null
    const now = await $.clock.now()

    if (!found) {
      return <Text dimColor>Looking at this project…</Text>
    }

    if (!found.isRepo) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{found.repo} isn't a git repo, so there's nothing to track yet.</Text>
          <Button key="refresh" dimColor label="Check again" onPress={() => refresh($)} />
        </Box>
      )
    }

    const stages = toStages(found, now)
    const fill = (text: string) => $.prompt.fill({ text, mode: 'replace' })

    return (
      <Box flexDirection="column" gap={1}>
        <Text wrap="truncate-end">
          <Text weight="semibold">{found.repo}</Text>
          <Text dimColor>  {found.branch}</Text>
        </Text>

        {e.surface !== 'terminal' && 'Svg' in elements ? (
          <elements.Svg
            source={toSvg(stages)}
            alt={`${found.repo}. ` + stages.map(stage => `${stage.name}: ${stage.note}`).join('. ')}
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
            {found.liveUrl ?? 'not found'}
            {found.isLiveUrlGuessed && <Text dimColor>  (found automatically)</Text>}
          </Text>
          <Text dimColor size="footnote">
            {checking ? 'Checking…' : `Checked ${ago(found.checkedAt, now)}`}
          </Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {stages.some(stage => stage.state === 'waiting') && (
            <Button key="ship" variant="primary" label="Ship it" onPress={() => fill(SHIP_PROMPT)} />
          )}
          {!found.liveUrl && (
            <Button key="url" label="Set live URL" onPress={() => fill('/ship-track url ')} />
          )}
          {following && (
            <Button key="here" dimColor label="Track this folder" onPress={() => goHome($)} />
          )}
          <Button key="refresh" dimColor label="Refresh" onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
