import type { Snapshot } from '../types'

export type StageState = 'done' | 'waiting' | 'problem' | 'off'
export type Stage = { name: string; state: StageState; note: string }

const COLORS: Record<StageState, string> = {
  done: '#2f9e6e',
  waiting: '#d4902b',
  problem: '#d0473f',
  off: '#9aa0a6',
}

export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60000))

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`

  return `${Math.round(minutes / 60 / 24)}d ago`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Turns one look at the project into the three stops of the track.
export function toStages(s: Snapshot, now: number): Stage[] {
  const local: Stage =
    s.dirty > 0
      ? { name: 'Commit', state: 'waiting', note: `${plural(s.dirty, 'file')} not committed` }
      : { name: 'Commit', state: 'done', note: s.lastCommit ? `${s.lastCommit.hash} · ${ago(s.lastCommit.at, now)}` : 'clean' }

  let github: Stage
  if (!s.hasRemote) {
    github = { name: 'GitHub', state: 'off', note: 'no GitHub remote' }
  } else if (s.ahead === null) {
    github = { name: 'GitHub', state: 'waiting', note: `${s.branch} not pushed yet` }
  } else if (s.ahead > 0) {
    github = { name: 'GitHub', state: 'waiting', note: `${plural(s.ahead, 'commit')} to push` }
  } else if (s.behind > 0) {
    github = { name: 'GitHub', state: 'problem', note: `${plural(s.behind, 'commit')} behind origin` }
  } else if (s.pr && s.pr.state === 'OPEN') {
    github = { name: 'GitHub', state: 'waiting', note: `PR #${s.pr.number} open` }
  } else {
    github = { name: 'GitHub', state: 'done', note: `up to date on ${s.branch}` }
  }

  let live: Stage
  if (!s.liveUrl) {
    live = { name: 'Live', state: 'off', note: 'no live URL yet' }
  } else if (s.liveStatus === null || s.liveStatus >= 400 || s.liveStatus === 0) {
    live = { name: 'Live', state: 'problem', note: s.liveStatus ? `site answers ${s.liveStatus}` : 'site not reachable' }
  } else if (s.lastDeployAt !== null && s.commitsSinceDeploy > 0) {
    live = { name: 'Live', state: 'waiting', note: `${plural(s.commitsSinceDeploy, 'commit')} since deploy` }
  } else if (s.lastDeployAt !== null) {
    live = { name: 'Live', state: 'done', note: `deployed ${ago(s.lastDeployAt, now)}` }
  } else {
    // Deploys that happen outside this session (Cloudflare's Git builds) leave
    // no record, so a pushed branch and a site that answers is the best sign.
    live = github.state === 'done'
      ? { name: 'Live', state: 'done', note: 'site is up' }
      : { name: 'Live', state: 'waiting', note: 'waiting on push' }
  }

  return [local, github, live]
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Draws the track: three stops joined by a rail that fills in as work moves
// along it. A stop that waits on something breathes; the rest stay still.
export function toSvg(stages: Stage[]): string {
  const width = 330
  const xs = [45, 165, 285]
  const y = 30
  const muted = '#9aa0a6'
  const rails = xs.slice(0, -1).map((x, i) => {
    const filled = stages[i]!.state === 'done'
    return `<line x1="${x + 13}" y1="${y}" x2="${xs[i + 1]! - 13}" y2="${y}" stroke="${filled ? COLORS.done : muted}" stroke-width="2" stroke-linecap="round" ${filled ? '' : 'stroke-dasharray="2 5" opacity="0.6"'}/>`
  })
  const stops = stages.map((stage, i) => {
    const x = xs[i]!
    const color = COLORS[stage.state]
    const inner =
      stage.state === 'done'
        ? `<path d="M${x - 5} ${y} l3.5 3.5 l6.5 -7" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : stage.state === 'problem'
          ? `<path d="M${x} ${y - 5} v6 M${x} ${y + 4.5} v0.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`
          : ''
    const fill = stage.state === 'off' ? 'none' : color
    const halo =
      stage.state === 'waiting'
        ? `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="${color}" stroke-width="1.5"><animate attributeName="r" values="11;17;11" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0;0.7" dur="2.4s" repeatCount="indefinite"/></circle>`
        : ''

    return `${halo}<circle cx="${x}" cy="${y}" r="11" fill="${fill}" stroke="${color}" stroke-width="2"/>${inner}
<text x="${x}" y="${y + 32}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" font-weight="600" fill="${stage.state === 'off' ? muted : color}">${escape(stage.name)}</text>
<text x="${x}" y="${y + 50}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11" fill="${muted}">${escape(stage.note.length > 22 ? `${stage.note.slice(0, 21)}…` : stage.note)}</text>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 92" width="${width}" height="92">${rails.join('')}${stops.join('')}</svg>`
}
