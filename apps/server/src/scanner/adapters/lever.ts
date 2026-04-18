import type { RawJob } from '../runner.js'

interface LeverJob {
  id: string
  text: string
  hostedUrl: string
  categories: { location?: string; team?: string; workplaceType?: string }
  descriptionPlain?: string
  description?: string
  salaryRange?: { min?: number; max?: number; currency?: string }
}

export async function scanLever(companyId: string, companyName: string): Promise<RawJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${companyId}?mode=json`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Lever ${companyId}: HTTP ${res.status}`)
  const data = await res.json() as LeverJob[]

  return (data ?? []).map(job => {
    const isRemote = job.categories?.workplaceType === 'remote' ||
      (job.categories?.location ?? '').toLowerCase().includes('remote')

    let comp_text: string | undefined
    if (job.salaryRange?.min && job.salaryRange?.max) {
      comp_text = `${job.salaryRange.currency ?? 'USD'} ${job.salaryRange.min}–${job.salaryRange.max}`
    }

    return {
      source: 'lever',
      external_id: job.id,
      url: job.hostedUrl,
      company: companyName,
      title: job.text,
      location: isRemote ? 'Remote' : job.categories?.location,
      remote_policy: isRemote ? 'remote' : undefined,
      comp_text,
      description: job.descriptionPlain ?? (job.description ? stripHtml(job.description) : undefined),
    }
  })
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
