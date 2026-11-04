import { expect, mock, test } from 'claude-code/testing'

import { afterDeploy, commandFolder, repoName, storeKey } from '../hooks/look'
import { toStages, toSvg } from '../hooks/stages'
import type { Snapshot } from '../types'

const NOW = 1_700_000_000_000

const BASE: Snapshot = {
  isRepo: true,
  repo: 'me/site',
  branch: 'main',
  dirty: 0,
  ahead: 0,
  behind: 0,
  lastCommit: { hash: 'abc1234', subject: 'Fix nav', at: NOW - 3_600_000 },
  hasRemote: true,
  pr: null,
  liveUrl: 'https://site.example.workers.dev',
  liveStatus: 200,
  lastDeployAt: NOW - 600_000,
  commitsSinceDeploy: 0,
  checkedAt: NOW,
}

const PANE = {
  plugin: 'ship-track',
  component: 'Pane',
  requestId: 'ship-track',
  props: {
    title: 'Ship Track',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a clean, pushed, deployed project is green all the way', () => {
  const stages = toStages(BASE, NOW)
  expect(stages.map(stage => stage.state)).toEqual(['done', 'done', 'done'])
  expect(stages[2]!.note).toBe('deployed 10m ago')
})

test('each stop waits on the right thing', () => {
  expect(toStages({ ...BASE, dirty: 3 }, NOW)[0]!.note).toBe('3 files not committed')
  expect(toStages({ ...BASE, ahead: 2 }, NOW)[1]!.note).toBe('2 commits to push')
  expect(toStages({ ...BASE, ahead: null }, NOW)[1]!.note).toBe('main not pushed yet')
  expect(toStages({ ...BASE, commitsSinceDeploy: 1 }, NOW)[2]!.state).toBe('waiting')
  expect(toStages({ ...BASE, liveStatus: 0 }, NOW)[2]!.note).toBe('site not reachable')
  expect(toStages({ ...BASE, liveUrl: null }, NOW)[2]!.state).toBe('off')
})

test('the drawing is one small svg with the notes in it', () => {
  const svg = toSvg(toStages({ ...BASE, ahead: 2 }, NOW))
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('2 commits to push')
  expect(svg).toContain('<animate')
  expect(svg.length < 131072).toBe(true)
})

test('the pane draws the track from git on every surface', async ($, on) => {
  const answers: Record<string, string> = {
    'rev-parse --is-inside-work-tree': 'true',
    'rev-parse --show-toplevel': 'C:/site',
    'rev-parse --abbrev-ref HEAD': 'main',
    'status --porcelain': ' M index.html\n',
    'rev-list --left-right --count @{u}...HEAD': '0\t1',
    'log -1 --format=%h%x1f%s%x1f%ct': 'abc1234\x1fAdd margin notes\x1f1699990000',
    'remote get-url origin': 'https://github.com/me/site.git',
  }
  on('process.run', (_, e) => {
    const out = answers[e.argv.slice(1).join(' ')]
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: 'C:/site' }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'ship-track' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: 'C:/site', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'me/site' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add margin notes/ })).toBeDefined()
    expect(await ui.find({ key: 'ship' })).toBeDefined()
    expect(await ui.find({ key: 'url' })).toBeDefined()
    if (surface === 'desktop') {
      const drawing = await ui.find({ type: 'Svg' })
      expect(drawing?.props.alt).toContain('Commit: 1 file not committed')
      expect(drawing?.props.alt).toContain('GitHub: 1 commit to push')
    } else {
      expect(await ui.find({ type: 'Text', text: /1 commit to push/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the repo is named from GitHub, else from the folder', () => {
  expect(repoName('https://github.com/ayden723/ship-and-pick.git', 'C:/x')).toBe('ayden723/ship-and-pick')
  expect(repoName('git@github.com:ayden723/site.git', 'C:/x')).toBe('ayden723/site')
  expect(repoName('https://github.com/me/site', 'C:/x')).toBe('me/site')
  expect(repoName(null, 'C:\\Users\\whoop\\Downloads\\New Spectrogram')).toBe('New Spectrogram')
  expect(repoName('https://gitlab.com/me/site.git', 'C:/work/site/')).toBe('site')
})

// The pane redraws once a background check finishes, so look a few times.
async function shows(ui: { find: (q: { type: 'Text'; text: string }) => Promise<unknown> }, text: string) {
  for (let i = 0; i < 500; i++) {
    if (await ui.find({ type: 'Text', text })) return true
    await Promise.resolve()
  }
  return false
}

test('a command names the folder it ships from', () => {
  expect(commandFolder('cd "/c/Users/me/Claude Code Mods" && git push')).toBe('C:/Users/me/Claude Code Mods')
  expect(commandFolder('git -C ../site commit -m "x"')).toBe('../site')
  expect(commandFolder("Set-Location 'C:\\work\\site'; git push")).toBe('C:\\work\\site')
  // A folder inside the same repo; follow() then finds the session's own repo.
  expect(commandFolder('npm run build && cd dist && wrangler deploy')).toBe('dist')
  expect(commandFolder('git push')).toBe(null)
  expect(commandFolder('cd ~ && git status')).toBe(null)
})

test('the pane follows the repo Claude pushed from, and comes back', async ($, on) => {
  const repos: Record<string, Record<string, string>> = {
    'C:/home': { 'remote get-url origin': 'https://github.com/me/home.git' },
    'C:/mods': { 'remote get-url origin': 'https://github.com/me/ship-and-pick.git' },
  }
  on('process.run', (_, e) => {
    const dir = e.init?.cwd === 'C:/mods' ? 'C:/mods' : 'C:/home'
    const args = e.argv.slice(1).join(' ')
    const out =
      args === 'rev-parse --is-inside-work-tree' ? 'true'
      : args === 'rev-parse --show-toplevel' ? dir
      : args === 'rev-parse --abbrev-ref HEAD' ? 'main'
      : repos[dir]![args]
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: 'C:/home' }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'ship-track' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: 'C:/home', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'cd "/c/mods" && git push' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shows(ui, 'me/ship-and-pick')).toBe(true)
  await ui.press({ key: 'here' })
  expect(await shows(ui, 'me/home')).toBe(true)
  expect(await ui.find({ key: 'here' })).toBeUndefined()
  await ui.unmount()
})

test('a deploy keeps a live URL set by hand and ignores other links', () => {
  const output = 'update available, see https://github.com\nUploaded my-site\n  https://mysite.com (custom domain)\n  https://my-site.me.workers.dev\n'
  expect(afterDeploy({ liveUrl: null, lastDeployAt: null }, output, NOW)).toEqual({
    lastDeployAt: NOW,
    liveUrl: 'https://my-site.me.workers.dev',
  })
  expect(afterDeploy({ liveUrl: 'https://mysite.com', lastDeployAt: null }, output, NOW)).toEqual({ lastDeployAt: NOW })
  expect(afterDeploy({ liveUrl: null, lastDeployAt: null }, 'see https://github.com\n', NOW)).toEqual({ lastDeployAt: NOW })
})

test('a site that never answers counts as unreachable', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { [storeKey('C:/site')]: { liveUrl: 'https://slow.example.com', lastDeployAt: null } })
  on('process.run', (_, e) => {
    const out = e.argv.slice(1).join(' ') === 'rev-parse --is-inside-work-tree' ? 'true' : undefined
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', () => new Promise(() => {}))
  on('session.cwd', () => ({ value: 'C:/site' }))
  on('command.register', () => ({ value: { command: 'ship-track' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  const started = $.session.start({ cwd: 'C:/site', surface: 'terminal', isInteractive: true })
  await clock.advance(6000)
  await started

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /site not reachable/ })).toBeDefined()
  await ui.unmount()
})
