import type { RawJob } from '../runner.js'

interface RemoteOKJob {
  id: string
  url: string
  position: string
  company: string
  location: string
  description: string
  salary_min?: number
  salary_max?: number
}

const TAGS = ['ai', 'machine-learning', 'nlp', 'llm']

export async function scanRemoteOK(): Promise<RawJob[]> {
  const seen = new Set<string>()
  const results: RawJob[] = []

  for (const tag of TAGS) {
    let data: unknown[]
    try {
      const res = await fetch(`https://remoteok.com/api?tags=${tag}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-pipeline/1.0)' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) continue
      data = await res.json() as unknown[]
    } catch {
      continue
    }

    for (const item of data) {
      if (!item || typeof item !== 'object' || 'legal' in item) continue
      const job = item as RemoteOKJob
      if (!job.id || !job.position || seen.has(job.id)) continue
      seen.add(job.id)

      const jobUrl = job.url?.startsWith('http') ? job.url : `https://remoteok.com${job.url}`
      results.push({
        source: 'remoteok',
        external_id: job.id,
        url: jobUrl,
        company: job.company ?? 'Unknown',
        title: job.position,
        location: job.location || 'Remote',
        remote_policy: 'remote',
        comp_text: job.salary_min ? `$${job.salary_min}–$${job.salary_max}` : undefined,
        description: job.description ? stripHtml(job.description) : undefined,
      })
    }

    await new Promise(r => setTimeout(r, 1500))
  }

  return results
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
