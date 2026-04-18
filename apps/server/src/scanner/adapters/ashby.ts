import type { RawJob } from '../runner.js'

interface AshbyJob {
  id: string
  title: string
  jobUrl: string
  isRemote: boolean
  location?: { name: string }
  descriptionHtml?: string
}

export async function scanAshby(companyId: string, companyName: string): Promise<RawJob[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${companyId}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Ashby ${companyId}: HTTP ${res.status}`)
  const data = await res.json() as { jobs: AshbyJob[] }

  return (data.jobs ?? []).map(job => ({
    source: 'ashby',
    external_id: job.id,
    url: job.jobUrl,
    company: companyName,
    title: job.title,
    location: job.isRemote ? 'Remote' : job.location?.name,
    remote_policy: job.isRemote ? 'remote' : undefined,
    description: job.descriptionHtml ? stripHtml(job.descriptionHtml) : undefined,
  }))
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
