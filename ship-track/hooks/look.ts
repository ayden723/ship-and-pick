import type { EngineInterface } from 'claude-code'

import type { PullRequest, Remembered, Snapshot } from '../types'

export const storeKey = (cwd: string) => `ship-track:${cwd.toLowerCase()}`

export async function remembered($: EngineInterface, cwd: string): Promise<Remembered> {
  const saved = (await $.store.get(storeKey(cwd))) as Partial<Remembered> | undefined

  return { liveUrl: saved?.liveUrl ?? null, lastDeployAt: saved?.lastDeployAt ?? null }
}

export async function remember($: EngineInterface, cwd: string, change: Partial<Remembered>) {
  await $.store.set(storeKey(cwd), { ...(await remembered($, cwd)), ...change })
}

async function run($: EngineInterface, argv: string[]): Promise<string | null> {
  try {
    const out = await $.process.run(argv, { timeoutMs: 8000 })

    return out.exitCode === 0 ? out.stdout.trim() : null
  } catch {
    return null
  }
}

async function liveStatus($: EngineInterface, url: string): Promise<number> {
  try {
    return (await $.http.fetch(url, { method: 'GET' })).status
  } catch {
    return 0
  }
}

// One look at the project: git for the first two stops, the stored live URL
// and last deploy for the third.
export async function look($: EngineInterface): Promise<Snapshot> {
  const cwd = await $.session.cwd()
  const now = await $.clock.now()
  const saved = await remembered($, cwd)
  const empty: Snapshot = {
    isRepo: false,
    branch: '',
    dirty: 0,
    ahead: null,
    behind: 0,
    lastCommit: null,
    hasRemote: false,
    pr: null,
    liveUrl: saved.liveUrl,
    liveStatus: null,
    lastDeployAt: saved.lastDeployAt,
    commitsSinceDeploy: 0,
    checkedAt: now,
  }

  if ((await run($, ['git', 'rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return empty
  }

  const [branch, status, counts, last, remote, pr, live] = await Promise.all([
    run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    run($, ['git', 'status', '--porcelain']),
    run($, ['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD']),
    run($, ['git', 'log', '-1', '--format=%h%x1f%s%x1f%ct']),
    run($, ['git', 'remote', 'get-url', 'origin']),
    run($, ['gh', 'pr', 'view', '--json', 'number,state,url']),
    saved.liveUrl ? liveStatus($, saved.liveUrl) : Promise.resolve(null),
  ])

  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [0, null]
  const [hash, subject, seconds] = last ? last.split('\x1f') : []
  let parsedPr: PullRequest | null = null
  try {
    parsedPr = pr ? (JSON.parse(pr) as PullRequest) : null
  } catch {
    parsedPr = null
  }
  const since = saved.lastDeployAt
    ? await run($, ['git', 'rev-list', '--count', `--since=${Math.floor(saved.lastDeployAt / 1000)}`, 'HEAD'])
    : null

  return {
    ...empty,
    isRepo: true,
    branch: branch ?? 'HEAD',
    dirty: status ? status.split('\n').filter(Boolean).length : 0,
    ahead: ahead ?? null,
    behind: behind ?? 0,
    lastCommit: hash ? { hash, subject: subject ?? '', at: Number(seconds) * 1000 } : null,
    hasRemote: remote !== null,
    pr: parsedPr,
    liveStatus: live,
    commitsSinceDeploy: since ? Number(since) : 0,
  }
}
