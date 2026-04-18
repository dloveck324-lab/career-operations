import { loadProfile, loadFilters, buildPrescreen } from '@job-pipeline/core'
import { getJobsForReprescreen, getJobsForLinkCheck, updateJobStatus } from '../db/queries.js'
import type { ScanEvent } from './runner.js'

// ── Re-prescreen existing inbox jobs with current filter rules ────────────────

export async function represcreenExisting(
  runId: number,
  emit: (e: ScanEvent) => void
): Promise<{ reskipped: number }> {
  const profile = loadProfile()
  const filters = loadFilters()
  const prescreenFn = profile
    ? buildPrescreen({ ...profile.prescreen, title_filter: filters?.title_filter })
    : buildPrescreen()
  const jobs = getJobsForReprescreen()

  let reskipped = 0
  for (const job of jobs) {
    const result = prescreenFn({
      title: job.title,
      location: job.location ?? undefined,
      description: job.description ?? undefined,
      comp_text: job.comp_text ?? undefined,
    })
    if (!result.pass) {
      updateJobStatus(job.id, 'skipped', { skip_reason: result.reason ?? 'Skipped: prescreen' })
      reskipped++
      emit({ type: 'progress', runId, reskipped })
    }
  }

  return { reskipped }
}

// ── Link check: verify job postings are still live ────────────────────────────

const CONCURRENCY = 15
const TIMEOUT_MS = 10_000

async function checkUrl(url: string): Promise<'active' | 'closed' | 'unknown'> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobPipeline/1.0)' },
    })
    clearTimeout(timer)
    return res.status === 404 || res.status === 410 ? 'closed' : 'active'
  } catch {
    return 'unknown'
  }
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (queue.length > 0) await fn(queue.shift()!)
    })
  )
}

export async function runLinkCheck(
  runId: number,
  emit: (e: ScanEvent) => void
): Promise<{ checked: number; closed: number }> {
  const jobs = getJobsForLinkCheck()
  if (jobs.length === 0) return { checked: 0, closed: 0 }

  emit({ type: 'progress', runId, message: `Link check: verifying ${jobs.length} job postings...` })

  let checked = 0
  let closed = 0

  await pool(jobs, CONCURRENCY, async (job) => {
    const status = await checkUrl(job.url)
    checked++
    if (status === 'closed') {
      closed++
      updateJobStatus(job.id, 'skipped', { skip_reason: 'Closed: link expired — job posting no longer available' })
    }
    if (checked % 25 === 0 || checked === jobs.length) {
      emit({ type: 'progress', runId, message: `Link check: ${checked}/${jobs.length} checked, ${closed} expired` })
    }
  })

  return { checked, closed }
}
