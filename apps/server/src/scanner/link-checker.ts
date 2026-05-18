import { loadProfile, loadFilters, buildPrescreen } from '@job-pipeline/core'
import { getJobsForReprescreen, getJobsForLinkCheck, updateJobStatus, getJob } from '../db/queries.js'
import type { ScanEvent } from './runner.js'

interface BaseStats { found: number; added: number; skipped: number; existing: number }

// ── Re-prescreen existing inbox jobs with current filter rules ────────────────

export async function represcreenExisting(
  runId: number,
  emit: (e: ScanEvent) => void,
  baseStats: BaseStats = { found: 0, added: 0, skipped: 0, existing: 0 }
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
      emit({ type: 'progress', runId, reskipped, ...baseStats })
    }
  }

  return { reskipped }
}

// ── Link check: verify job postings are still live ────────────────────────────

const CONCURRENCY = 20
const TIMEOUT_MS = 10_000
const LINK_CHECK_MAX_MS = 8 * 60_000 // 8-minute hard cap (raised from 5 to cover larger pipelines)
const GET_BODY_MAX_BYTES = 60_000     // soft-404 body scan only — read at most ~60KB

/**
 * Phrases that indicate a soft-404: HTTP 200 page but the posting is closed.
 * Matched case-insensitively against the page body. Conservative — these are
 * specific enough that false-positives are rare. Many ATSes (LinkedIn,
 * Workday, custom career sites) return 200 with one of these phrases when
 * a job is filled or pulled.
 */
const SOFT_404_PHRASES: RegExp[] = [
  /no longer accepting applications/i,
  /no longer available/i,
  /this position has been filled/i,
  /position has been filled/i,
  /this job (?:has been|is) closed/i,
  /this role (?:has been|is) closed/i,
  /this position is (?:no longer|not) (?:active|open|available)/i,
  /job posting (?:has been |is )?closed/i,
  /requisition (?:is )?closed/i,
  /we are no longer accepting/i,
  /this opportunity is no longer/i,
]

export type LinkStatus = 'active' | 'closed' | 'unknown'

/**
 * HEAD first; if HEAD is 404/410, closed. If HEAD is 200/3xx, fall back to
 * GET and scan the (truncated) body for soft-404 phrases. The body scan only
 * triggers on HEAD 200 to keep cost low — and we hard-cap the read at 60KB.
 */
export async function checkUrl(url: string): Promise<LinkStatus> {
  // Phase 1: HEAD. Cheap; catches the common Greenhouse / Lever / Ashby case.
  let headStatus: number | null = null
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
    headStatus = res.status
    if (res.status === 404 || res.status === 410) return 'closed'
    // 5xx / 403 / 401 → unknown (likely transient or login wall)
    if (res.status >= 500 || res.status === 403 || res.status === 401) return 'unknown'
  } catch {
    return 'unknown'
  }

  // Phase 2: GET fallback for soft-404. Only fire when HEAD returned a
  // "success-ish" code (200 or a 3xx that already followed).
  if (headStatus === null || headStatus >= 400) return 'unknown'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobPipeline/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(timer)
    if (res.status === 404 || res.status === 410) return 'closed'
    if (res.status >= 400) return 'unknown'
    // Stream-bounded read so a large career page can't blow memory.
    const reader = res.body?.getReader()
    if (!reader) return 'active'
    const decoder = new TextDecoder()
    let buf = ''
    let total = 0
    while (total < GET_BODY_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      buf += decoder.decode(value, { stream: true })
      if (SOFT_404_PHRASES.some((re) => re.test(buf))) {
        reader.cancel().catch(() => {})
        return 'closed'
      }
    }
    reader.cancel().catch(() => {})
    return 'active'
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

interface LinkCheckStats extends BaseStats { reskipped: number }

async function _runLinkCheck(
  runId: number,
  emit: (e: ScanEvent) => void,
  baseStats: LinkCheckStats
): Promise<{ checked: number; closed: number }> {
  const jobs = getJobsForLinkCheck()
  if (jobs.length === 0) return { checked: 0, closed: 0 }

  emit({ type: 'progress', runId, message: `Link check: verifying ${jobs.length} postings…`, ...baseStats })

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
      emit({
        type: 'progress', runId,
        message: `Link check: ${checked}/${jobs.length} · ${closed} expired`,
        linkClosed: closed,
        ...baseStats,
      })
    }
  })

  return { checked, closed }
}

export async function runLinkCheck(
  runId: number,
  emit: (e: ScanEvent) => void,
  baseStats: LinkCheckStats = { found: 0, added: 0, skipped: 0, existing: 0, reskipped: 0 }
): Promise<{ checked: number; closed: number }> {
  const hardTimeout = new Promise<{ checked: number; closed: number }>((resolve) => {
    setTimeout(() => {
      emit({ type: 'error', runId, message: 'Link check timed out — skipped remaining URLs' })
      resolve({ checked: 0, closed: 0 })
    }, LINK_CHECK_MAX_MS)
  })
  return Promise.race([_runLinkCheck(runId, emit, baseStats), hardTimeout])
}

// ── Standalone link check (manual trigger) ─────────────────────────────────────

/**
 * Standalone variant that ignores the recency cutoff and uses a much higher
 * cap. Built for the "Re-check links" button — sweeps every prescreened or
 * evaluated job in one pass, not just the >3 days old slice.
 */
export async function runStandaloneLinkCheck(
  runId: number,
  emit: (e: ScanEvent) => void,
): Promise<{ checked: number; closed: number }> {
  const jobs = getJobsForLinkCheck(0, 10_000)  // olderThanDays=0 → all; cap raised
  if (jobs.length === 0) return { checked: 0, closed: 0 }

  emit({ type: 'progress', runId, message: `Re-check: verifying ${jobs.length} postings…`, found: 0, added: 0, skipped: 0, existing: 0 })

  let checked = 0
  let closed = 0

  const inner = pool(jobs, CONCURRENCY, async (job) => {
    const status = await checkUrl(job.url)
    checked++
    if (status === 'closed') {
      closed++
      updateJobStatus(job.id, 'skipped', { skip_reason: 'Closed: link expired — job posting no longer available' })
    }
    if (checked % 25 === 0 || checked === jobs.length) {
      emit({
        type: 'progress', runId,
        message: `Re-check: ${checked}/${jobs.length} · ${closed} expired`,
        linkClosed: closed,
        found: 0, added: 0, skipped: 0, existing: 0,
      })
    }
  })

  const hardTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      emit({ type: 'error', runId, message: 'Re-check timed out — partial results saved' })
      resolve()
    }, LINK_CHECK_MAX_MS)
  })

  await Promise.race([inner, hardTimeout])
  return { checked, closed }
}

/**
 * Single-job recheck. Used by the drawer's "Re-check" action so the user can
 * verify a posting on demand right before auto-apply. Synchronous — returns
 * the result so the UI can confirm immediately.
 */
export async function recheckSingleJob(jobId: number): Promise<{ status: LinkStatus; updated: boolean }> {
  const job = getJob(jobId)
  if (!job) throw new Error(`Job ${jobId} not found`)
  const status = await checkUrl(job.url)
  if (status === 'closed') {
    updateJobStatus(jobId, 'skipped', { skip_reason: 'Closed: link expired — job posting no longer available' })
    return { status, updated: true }
  }
  return { status, updated: false }
}
