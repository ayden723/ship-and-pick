import type { EngineInterface } from 'claude-code'

import type { PullRequest, Remembered, Snapshot } from '../types'

import { cleanUrl, learnSubdomain, liveUrlGuesses } from './detect'

export const storeKey = (cwd: string) => `ship-track:${cwd.toLowerCase()}`

export async function remembered($: EngineInterface, cwd: string): Promise<Remembered> {
  const saved = (await $.store.get(storeKey(cwd))) as Partial<Remembered> | undefined

  const liveUrl = cleanUrl(saved?.liveUrl)

  return { liveUrl, lastDeployAt: saved?.lastDeployAt ?? null, isGuessed: liveUrl !== null && saved?.isGuessed === true }
}

export async function remember($: EngineInterface, cwd: string, change: Partial<Remembered>) {
  await $.store.set(storeKey(cwd), { ...(await remembered($, cwd)), ...change })
}

async function run($: EngineInterface, cwd: string, argv: string[]): Promise<string | null> {
  try {
    const out = await $.process.run(argv, { cwd, timeoutMs: 8000 })

    return out.exitCode === 0 ? out.stdout.trim() : null
  } catch {
    return null
  }
}

const LIVE_TIMEOUT_MS = 6000

// A site that never answers counts as unreachable instead of holding the
// check, and with it the start of the session, open.
async function liveStatus($: EngineInterface, url: string): Promise<number> {
  let timer: { cancel: () => void } | undefined
  const gaveUp = new Promise<number>(resolve => {
    timer = $.clock.after(LIVE_TIMEOUT_MS, () => resolve(0))
  })
  try {
    return await Promise.race([$.http.fetch(url, { method: 'GET' }).then(res => res.status), gaveUp])
  } catch {
    return 0
  } finally {
    timer?.cancel()
  }
}

// "owner/name" from a GitHub remote in either form (https or git@), else the
// last part of the folder path.
export function repoName(remote: string | null, folder: string): string {
  const github = remote?.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i)

  return github ? github[1]! : folder.split(/[\\/]/).filter(Boolean).pop() ?? folder
}

const DEPLOYED_URL = /https:\/\/[^\s'"<>)]+?\.(?:workers|pages)\.dev\b[^\s'"<>)]*/i

// What a successful deploy changes. The workers.dev or pages.dev address
// wrangler printed becomes the live URL when none is set or the one set was
// only a guess, so a custom domain set with /ship-track url stays.
export function afterDeploy(saved: Remembered, output: string, at: number): Partial<Remembered> {
  const url = output.match(DEPLOYED_URL)?.[0] ?? null

  return url && (!saved.liveUrl || saved.isGuessed) ? { lastDeployAt: at, liveUrl: url, isGuessed: false } : { lastDeployAt: at }
}

const GUESS_EVERY_MS = 10 * 60 * 1000
const lastGuessAt = new Map<string, number>()

// Forgets when a folder was last guessed for, so the next look guesses again.
export const guessAgain = (cwd: string) => lastGuessAt.delete(cwd.toLowerCase())

// With no live URL set, tries each likely address and keeps the first that
// answers. Looks again at most every ten minutes while nothing answers.
async function findLiveUrl($: EngineInterface, cwd: string, top: string, now: number): Promise<string | null> {
  const key = cwd.toLowerCase()
  if (now - (lastGuessAt.get(key) ?? -Infinity) < GUESS_EVERY_MS) return null
  lastGuessAt.set(key, now)

  const homepage = await run($, top, ['gh', 'repo', 'view', '--json', 'homepageUrl', '--jq', '.homepageUrl'])
  for (const url of await liveUrlGuesses($, top, homepage || null)) {
    const status = await liveStatus($, url)
    if (status > 0 && status < 400) {
      await remember($, cwd, { liveUrl: url, isGuessed: true })
      await learnSubdomain($, url)
      return url
    }
  }

  return null
}

const QUOTED = String.raw`"([^"]+)"|'([^']+)'|([^\s;&|]+)`
const GIT_DASH_C = new RegExp(String.raw`\bgit\s+-C\s+(?:${QUOTED})`)
const CD = new RegExp(String.raw`(?:^|&&|;|\|\|)\s*(?:cd|Set-Location|pushd)\s+(?:${QUOTED})`, 'i')

// The folder a shell command works in when it says so with `git -C <dir>` or
// a leading `cd <dir>`, in the form git can take on Windows. Null when the
// command runs where the session is.
export function commandFolder(command: string): string | null {
  const m = command.match(GIT_DASH_C) ?? command.match(CD)
  const dir = m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
  if (!dir || /^[~$-]/.test(dir)) return null

  // Git Bash spells C:\ as /c/.
  return dir.replace(/^\/([a-z])(?=\/|$)/i, (_, drive: string) => `${drive.toUpperCase()}:`)
}

// The top folder of the repo that holds `dir`, or null outside a repo.
export async function repoRoot($: EngineInterface, dir: string): Promise<string | null> {
  return run($, dir, ['git', 'rev-parse', '--show-toplevel'])
}

// One look at the project in `folder` (the session's folder when null): git
// for the first two stops, the stored live URL and last deploy for the third.
export async function look($: EngineInterface, folder: string | null = null): Promise<Snapshot> {
  const cwd = folder ?? (await $.session.cwd())
  const now = await $.clock.now()
  let saved = await remembered($, cwd)
  const empty: Snapshot = {
    isRepo: false,
    repo: repoName(null, cwd),
    branch: '',
    dirty: 0,
    ahead: null,
    behind: 0,
    lastCommit: null,
    hasRemote: false,
    pr: null,
    liveUrl: saved.liveUrl,
    isLiveUrlGuessed: saved.isGuessed,
    liveStatus: null,
    lastDeployAt: saved.lastDeployAt,
    commitsSinceDeploy: 0,
    checkedAt: now,
  }

  if ((await run($, cwd, ['git', 'rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return empty
  }

  if (!saved.liveUrl) {
    const top = await run($, cwd, ['git', 'rev-parse', '--show-toplevel'])
    if (top && (await findLiveUrl($, cwd, top, now))) saved = await remembered($, cwd)
  }

  const [top, branch, status, counts, last, remote, pr, live] = await Promise.all([
    run($, cwd, ['git', 'rev-parse', '--show-toplevel']),
    run($, cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    run($, cwd, ['git', 'status', '--porcelain']),
    run($, cwd, ['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD']),
    run($, cwd, ['git', 'log', '-1', '--format=%h%x1f%s%x1f%ct']),
    run($, cwd, ['git', 'remote', 'get-url', 'origin']),
    run($, cwd, ['gh', 'pr', 'view', '--json', 'number,state,url']),
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
    ? await run($, cwd, ['git', 'rev-list', '--count', `--since=${Math.floor(saved.lastDeployAt / 1000)}`, 'HEAD'])
    : null

  return {
    ...empty,
    isRepo: true,
    repo: repoName(remote, top ?? cwd),
    branch: branch ?? 'HEAD',
    dirty: status ? status.split('\n').filter(Boolean).length : 0,
    ahead: ahead ?? null,
    behind: behind ?? 0,
    lastCommit: hash ? { hash, subject: subject ?? '', at: Number(seconds) * 1000 } : null,
    hasRemote: remote !== null,
    pr: parsedPr,
    liveUrl: saved.liveUrl,
    isLiveUrlGuessed: saved.isGuessed,
    liveStatus: live,
    commitsSinceDeploy: since ? Number(since) : 0,
  }
}
