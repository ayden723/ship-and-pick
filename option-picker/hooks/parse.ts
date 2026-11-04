import type { Option } from '../types'

const ITEM = /^(\s{0,3})(\d{1,2})[.)]\s+(.+)$/
const FENCE = /^\s*(```|~~~)/
// A numbered list only counts as a menu when the words just before it or
// after it offer a choice: a question about choosing, or a word that names
// the items as choices. "which" in a plain sentence is not enough.
const ASKS = /\b(which|what|want me to|would you like|should I|shall I|prefer|go with)\b[^?\n]*\?/i
const OFFERS = /\b(options?|pick|choose|ideas?|suggest\w*|directions?|variants?|alternatives?|approaches)\b/i
const MAX_LABEL = 42

type Run = { options: Option[]; indent: number; first: number; last: number }

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

// The paragraph right before the run and everything after it.
function isOffered(lines: string[], run: Run): boolean {
  let end = run.first - 1
  while (end >= 0 && lines[end]!.trim() === '') end--
  let start = end
  while (start > 0 && lines[start - 1]!.trim() !== '') start--
  const around = [...lines.slice(Math.max(start, 0), end + 1), ...lines.slice(run.last + 1)].join('\n')

  return ASKS.test(around) || OFFERS.test(around)
}

// Finds the last offered run of items numbered 1, 2, 3... in a reply. Blank
// lines, indented lines and nested lists may sit between items; any other
// line ends the run. Lists inside code blocks are skipped.
export function findOptions(answer: string): Option[] {
  const lines = answer.split(/\r?\n/)
  let best: Option[] = []
  let run: Run | undefined
  let inFence = false
  const end = (done: Run | undefined) => {
    if (done && done.options.length >= 2 && isOffered(lines, done)) {
      best = done.options
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (FENCE.test(line)) {
      inFence = !inFence
      if (!/^\s/.test(line)) {
        end(run)
        run = undefined
      }
      continue
    }
    if (inFence) {
      continue
    }

    const item = line.match(ITEM)
    // An item indented past the run's own is a nested list inside an option.
    const isNested = item && run && item[1]!.length > run.indent

    if (item && !isNested) {
      const n = Number(item[2])
      const option = { n, label: toLabel(item[3]!) }

      if (run && n === run.options.length + 1) {
        run.options.push(option)
        run.last = i
      } else {
        end(run)
        run = n === 1 ? { options: [option], indent: item[1]!.length, first: i, last: i } : undefined
      }
    } else if (line.trim() !== '' && !/^\s/.test(line)) {
      end(run)
      run = undefined
    }
  }
  end(run)

  return best.length <= 12 ? best : []
}
