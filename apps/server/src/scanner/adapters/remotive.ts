import type { RawJob } from '../runner.js'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  candidate_required_location: string
  salary: string
  description: string
}

export async function scanRemotive(): Promise<RawJob[]> {
  const url = 'https://remotive.com/api/remote-jobs?category=software-dev&limit=100'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-pipeline/1.0)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Remotive: HTTP ${res.status}`)
  const data = await res.json() as { jobs: RemotiveJob[] }

  return (data.jobs ?? []).map(job => ({
    source: 'remotive',
    external_id: String(job.id),
    url: job.url,
    company: job.company_name,
    title: job.title,
    location: job.candidate_required_location || 'Remote',
    remote_policy: 'remote',
    comp_text: job.salary || undefined,
    description: job.description ? stripHtml(job.description) : undefined,
  }))
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
