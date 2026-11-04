import type { Snapshot } from '../types'

export type StageState = 'done' | 'waiting' | 'problem' | 'off'
export type Stage = { name: string; state: StageState; note: string }

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

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// Colors for each theme. The drawing is shown as an image, which follows the
// app's light or dark mode through prefers-color-scheme.
const STYLE = `
.done{--c:#1f8a5b}.waiting{--c:#b7791f}.problem{--c:#c2413a}.off{--c:#8a9099}
.dot{fill:var(--c);stroke:var(--c)}.off .dot{fill:none}
.ring{fill:none;stroke:var(--c)}
.name{fill:var(--c);font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif}
.off .name{fill:#6b7079}
.note{fill:#5b616b;font:11px system-ui,-apple-system,"Segoe UI",sans-serif}
.mark{stroke:#fff}
.rail{stroke:#c5c9cf}.rail.on{stroke:#1f8a5b}
@media (prefers-color-scheme:dark){
.done{--c:#4cc38a}.waiting{--c:#f0b24a}.problem{--c:#ef6a5f}.off{--c:#7d838c}
.off .name{fill:#9aa0a8}.note{fill:#a3a9b2}.mark{stroke:#111418}
.rail{stroke:#3d4249}.rail.on{stroke:#4cc38a}}`

// Draws the track: three stops joined by a rail that fills in as work moves
// along it. A stop that waits on something breathes; the rest stay still.
export function toSvg(stages: Stage[]): string {
  // Each stop gets a third of the width, room for its note's 24 characters.
  const width = 408
  const xs = [68, 204, 340]
  const y = 28
  const r = 12

  const rails = xs.slice(0, -1).map((x, i) => {
    const isOn = stages[i]!.state === 'done'
    const dash = isOn ? '' : ' stroke-dasharray="1 6"'
    return `<line class="rail${isOn ? ' on' : ''}" x1="${x + r + 6}" y1="${y}" x2="${xs[i + 1]! - r - 6}" y2="${y}" stroke-width="2" stroke-linecap="round"${dash}/>`
  })

  const stops = stages.map((stage, i) => {
    const x = xs[i]!
    const mark =
      stage.state === 'done'
        ? `<path class="mark" d="M${x - 5} ${y} l3.5 3.5 l6.5 -7" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
        : stage.state === 'problem'
          ? `<path class="mark" d="M${x} ${y - 5.5} v6.5 M${x} ${y + 5} v0.4" stroke-width="2.2" stroke-linecap="round"/>`
          : stage.state === 'waiting'
            ? `<circle class="mark" cx="${x}" cy="${y}" r="3" fill="none" stroke-width="2"/>`
            : ''
    const pulse =
      stage.state === 'waiting'
        ? `<circle class="ring" cx="${x}" cy="${y}" r="${r}" stroke-width="1.5"><animate attributeName="r" values="${r};${r + 7};${r}" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite"/></circle>`
        : ''

    return `<g class="${stage.state}">${pulse}<circle class="dot" cx="${x}" cy="${y}" r="${r}" stroke-width="2"/>${mark}<text class="name" x="${x}" y="${y + 34}" text-anchor="middle">${escape(stage.name)}</text><text class="note" x="${x}" y="${y + 52}" text-anchor="middle">${escape(clip(stage.note, 24))}</text></g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 90" width="${width}" height="90"><style>${STYLE}</style>${rails.join('')}${stops.join('')}</svg>`
}
