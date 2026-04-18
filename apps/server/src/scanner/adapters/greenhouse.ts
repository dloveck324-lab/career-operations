import type { RawJob } from '../runner.js'

interface GreenhouseJob {
  id: number
  title: string
  absolute_url: string
  location: { name: string }
  content?: string
  metadata?: Array<{ name: string; value: unknown }>
}

export async function scanGreenhouse(companyId: string, companyName: string): Promise<RawJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${companyId}/jobs?content=true`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Greenhouse ${companyId}: HTTP ${res.status}`)
  const data = await res.json() as { jobs: GreenhouseJob[] }

  return (data.jobs ?? []).map(job => ({
    source: 'greenhouse',
    external_id: String(job.id),
    url: job.absolute_url,
    company: companyName,
    title: job.title,
    location: job.location?.name,
    description: job.content ? stripHtml(job.content) : undefined,
  }))
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
