import type { Option } from '../types'

const ITEM = /^\s{0,3}(\d{1,2})[.)]\s+(.+)$/
// A numbered list only counts as a menu when the reply talks about choosing.
const CHOICE = /\b(options?|pick|choose|which|ideas?|suggest\w*|prefer|keep|want me to|directions?|variants?)\b/i
const MAX_LABEL = 42

// Shortens one list item to a chip label: its bold title when it has one,
// else the text before the first colon, dash or sentence end.
export function toLabel(raw: string): string {
  const bold = raw.match(/\*\*(.+?)\*\*/)
  let text = bold?.[1] ?? raw
  text = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .split(/\s+[—–-]\s+|:\s|\.\s/)[0]!
    .replace(/[.:]$/, '')
    .trim()

  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1).trimEnd()}…` : text
}

// Finds the last run of items numbered 1, 2, 3... in a reply. Blank lines,
// indented lines and sub-bullets may sit between items; any other line ends
// the run.
export function findOptions(answer: string): Option[] {
  if (!CHOICE.test(answer)) {
    return []
  }

  let best: Option[] = []
  let run: Option[] = []

  for (const line of answer.split(/\r?\n/)) {
    const item = line.match(ITEM)

    if (item) {
      const n = Number(item[1])

      if (n === run.length + 1) {
        run.push({ n, label: toLabel(item[2]!) })
      } else {
        run = n === 1 ? [{ n, label: toLabel(item[2]!) }] : []
      }
    } else if (line.trim() !== '' && !/^\s/.test(line)) {
      if (run.length >= 2) {
        best = run
      }
      run = []
    }
  }

  if (run.length >= 2) {
    best = run
  }

  return best.length <= 12 ? best : []
}
