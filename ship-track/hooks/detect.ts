import type { EngineInterface } from 'claude-code'

// A link worth checking: http or https with a real host name, so a bare
// "https://" left over from the Set live URL button doesn't count.
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const url = value.trim()

  return /^https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i.test(url) ? url.replace(/\/$/, '') : null
}

export type WranglerSite = { name: string | null; domains: string[] }

// The Worker's name and any custom domains from a wrangler.jsonc, .json or
// .toml. Read with patterns rather than parsed, since jsonc and toml differ.
export function readWrangler(text: string): WranglerSite {
  const lines = text.split('\n').filter(line => !/^\s*(\/\/|#)/.test(line)).join('\n')
  const name = lines.match(/(?:^|[{,])\s*"?name"?\s*[:=]\s*["']([^"']+)["']/m)?.[1] ?? null
  const routes = [
    ...[...lines.matchAll(/"?(?:pattern|route)"?\s*[:=]\s*["']([^"']+)["']/g)].map(m => m[1]!),
    ...[...lines.matchAll(/"?routes"?\s*[:=]\s*\[([^\]]*)\]/g)].flatMap(m => [...m[1]!.matchAll(/["']([^"']+)["']/g)].map(s => s[1]!)),
  ]
  const domains = routes
    .map(route => route.replace(/^\*\./, '').replace(/\/.*$/, ''))
    .filter(host => host.includes('.') && !host.includes('*'))

  return { name, domains: [...new Set(domains)] }
}

const WORKERS_DEV = /https:\/\/[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev\b/i
const SUBDOMAIN_KEY = 'workers-subdomain'

// The account part of a workers.dev address ("me" in site.me.workers.dev).
export function workersSubdomain(text: string): string | null {
  return text.match(WORKERS_DEV)?.[1]?.toLowerCase() ?? null
}

// Every Worker on a Cloudflare account shares one workers.dev subdomain, so one
// address seen anywhere (a deploy, a command, a link set by hand) is enough to
// work out the address of the account's other Workers.
export async function learnSubdomain($: EngineInterface, text: string) {
  const sub = workersSubdomain(text)
  if (sub && (await $.store.get(SUBDOMAIN_KEY)) !== sub) await $.store.set(SUBDOMAIN_KEY, sub)
}

export async function knownSubdomain($: EngineInterface): Promise<string | null> {
  const saved = await $.store.get(SUBDOMAIN_KEY)
  if (typeof saved === 'string') return saved

  for (const key of await $.store.keys()) {
    const sub = workersSubdomain(String(((await $.store.get(key)) as { liveUrl?: unknown } | undefined)?.liveUrl ?? ''))
    if (sub) return sub
  }

  return null
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// Where the project's site probably lives, best guess first: a custom domain in
// the wrangler config, the GitHub repo's website, a link to the Worker in the
// README or CLAUDE.md, then the Worker's own workers.dev address.
export async function liveUrlGuesses($: EngineInterface, top: string, homepage: string | null): Promise<string[]> {
  let site: WranglerSite = { name: null, domains: [] }
  for (const file of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    const text = await readText($, `${top}/${file}`)
    if (text !== null) {
      site = readWrangler(text)
      break
    }
  }

  const guesses = [...site.domains.map(host => `https://${host}`), homepage]
  if (site.name) {
    const name = site.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const doc of ['README.md', 'CLAUDE.md']) {
      const text = (await readText($, `${top}/${doc}`)) ?? ''
      await learnSubdomain($, text)
      guesses.push(...[...text.matchAll(new RegExp(String.raw`https://${name}\.[^\s'"<>)\]]+`, 'gi'))].map(m => m[0]))
    }
    const sub = await knownSubdomain($)
    if (sub) guesses.push(`https://${site.name}.${sub}.workers.dev`)
  }

  return [...new Set(guesses.map(cleanUrl).filter((url): url is string => url !== null))]
}
