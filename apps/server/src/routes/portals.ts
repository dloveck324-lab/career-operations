import { type FastifyInstance } from 'fastify'

interface DiscoveredPortal {
  name: string
  type: string
  company_id: string
  url: string
  notes: string
  source: string
}

const GREENHOUSE_BOARDS = [
  { slug: 'ycombinator', label: 'Y Combinator' },
  { slug: 'greylock', label: 'Greylock' },
  { slug: 'khoslaventures', label: 'Khosla Ventures' },
  { slug: 'sequoia', label: 'Sequoia' },
  { slug: 'a16z', label: 'Andreessen Horowitz' },
  { slug: 'generalcatalyst', label: 'General Catalyst' },
]

async function scanGreenhouseBoard(boardSlug: string, label: string): Promise<DiscoveredPortal[]> {
  try {
    const resp = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardSlug}/jobs`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!resp.ok) return []
    const data = await resp.json() as { jobs?: Array<{ absolute_url?: string }> }

    const companies = new Map<string, string>()
    for (const job of data.jobs ?? []) {
      const match = job.absolute_url?.match(/greenhouse\.io\/([^/]+)\/jobs\//)
      if (!match || match[1] === boardSlug) continue
      const id = match[1]
      if (!companies.has(id)) {
        const name = id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        companies.set(id, name)
      }
    }

    return Array.from(companies.entries()).map(([company_id, name]) => ({
      name,
      type: 'greenhouse',
      company_id,
      url: `https://job-boards.greenhouse.io/${company_id}`,
      notes: '',
      source: label,
    }))
  } catch {
    return []
  }
}

export async function portalsRoutes(app: FastifyInstance) {
  app.get('/portals/discover', async () => {
    const results = await Promise.allSettled(
      GREENHOUSE_BOARDS.map(b => scanGreenhouseBoard(b.slug, b.label)),
    )

    const all: DiscoveredPortal[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value)
    }

    // Dedup by company_id (first source wins)
    const seen = new Set<string>()
    const unique = all.filter(p => {
      if (seen.has(p.company_id)) return false
      seen.add(p.company_id)
      return true
    })

    return { portals: unique.sort((a, b) => a.name.localeCompare(b.name)) }
  })
}
