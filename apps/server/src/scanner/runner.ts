import { loadFilters, loadProfile, buildPrescreen } from '@job-pipeline/core'
import { upsertJob, upsertJobContent, hashText } from '../db/queries.js'
import { scanGreenhouse } from './adapters/greenhouse.js'
import { scanAshby } from './adapters/ashby.js'
import { scanLever } from './adapters/lever.js'
import { scanIndeedRss } from './adapters/indeed-rss.js'
import { represcreenExisting, runLinkCheck } from './link-checker.js'

export interface ScanEvent {
  type: 'start' | 'progress' | 'done' | 'error' | 'scan_paused' | 'eval_start' | 'eval_done' | 'eval_error' | 'eval_all_done' | 'eval_paused'
  runId?: number
  message?: string
  found?: number
  added?: number
  skipped?: number
  existing?: number
  reskipped?: number
  linkClosed?: number
  [key: string]: unknown
}

export interface RawJob {
  source: string
  external_id: string
  url: string
  company: string
  title: string
  location?: string
  remote_policy?: string
  comp_text?: string
  description?: string
  raw_text?: string
}

export async function runScan(
  runId: number,
  emit: (event: ScanEvent) => void,
  isPaused: () => boolean = () => false
): Promise<{ found: number; added: number; skipped: number; existing: number; reskipped: number; linkClosed: number; paused: boolean }> {
  const filters = loadFilters()
  const profile = loadProfile()
  const prescreenFn = profile
    ? buildPrescreen({ ...profile.prescreen, title_filter: filters?.title_filter })
    : buildPrescreen()

  const stats = { found: 0, added: 0, skipped: 0, existing: 0 }

  const processJob = (raw: RawJob) => {
    stats.found++

    const prescreenResult = prescreenFn({
      title: raw.title,
      location: raw.location,
      description: raw.description,
      comp_text: raw.comp_text,
    })

    const status = prescreenResult.pass ? 'prescreened' as const : 'skipped' as const

    const { inserted, id } = upsertJob({
      source: raw.source,
      external_id: raw.external_id,
      url: raw.url,
      company: raw.company,
      title: raw.title,
      location: raw.location,
      remote_policy: raw.remote_policy,
      comp_text: raw.comp_text,
      description_hash: raw.description ? hashText(raw.description) : undefined,
      status,
      archetype: prescreenResult.archetype ?? undefined,
      score: undefined,
      score_reason: undefined,
      skip_reason: prescreenResult.reason ?? 'Skipped: prescreen',
    })

    if (inserted) {
      if (raw.description || raw.raw_text) {
        upsertJobContent(id, raw.raw_text ?? raw.description ?? '', raw.description ?? raw.raw_text ?? '')
      }
      status === 'prescreened' ? stats.added++ : stats.skipped++
    } else {
      stats.existing++
    }

    // Emit for new jobs always; for existing jobs every 10 to avoid flooding
    if (inserted || stats.existing % 10 === 0) {
      emit({ type: 'progress', runId, company: raw.company, title: raw.title, status: inserted ? status : 'existing', found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing })
    }
  }

  const portals = filters?.portals?.filter(p => p.enabled) ?? []

  // Run API-based scanners
  await Promise.allSettled([
    ...portals.filter(p => p.type === 'greenhouse').map(p =>
      scanGreenhouse(p.company_id!, p.name).then(jobs => jobs.forEach(processJob)).catch(err =>
        emit({ type: 'error', runId, message: `Greenhouse ${p.name}: ${err}` })
      )
    ),
    ...portals.filter(p => p.type === 'ashby').map(p =>
      scanAshby(p.company_id!, p.name).then(jobs => jobs.forEach(processJob)).catch(err =>
        emit({ type: 'error', runId, message: `Ashby ${p.name}: ${err}` })
      )
    ),
    ...portals.filter(p => p.type === 'lever').map(p =>
      scanLever(p.company_id!, p.name).then(jobs => jobs.forEach(processJob)).catch(err =>
        emit({ type: 'error', runId, message: `Lever ${p.name}: ${err}` })
      )
    ),
  ])

  if (isPaused()) {
    emit({ type: 'progress', runId, found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing })
    return { ...stats, reskipped: 0, linkClosed: 0, paused: true }
  }

  // RSS sources — throttled: 2 s between requests to avoid Indeed 429s
  const rssBoards = filters?.job_boards?.filter(b => b.type === 'indeed_rss' && b.enabled) ?? []
  for (const board of rssBoards) {
    for (const query of board.queries) {
      if (isPaused()) {
        emit({ type: 'progress', runId, found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing })
        return { ...stats, reskipped: 0, linkClosed: 0, paused: true }
      }
      try {
        const jobs = await scanIndeedRss(query)
        jobs.forEach(processJob)
      } catch (err) {
        emit({ type: 'error', runId, message: `Indeed RSS "${query}": ${err}` })
      }
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  if (isPaused()) {
    emit({ type: 'progress', runId, found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing })
    return { ...stats, reskipped: 0, linkClosed: 0, paused: true }
  }

  let reskipped = 0
  let linkClosed = 0

  try {
    ;({ reskipped } = await represcreenExisting(runId, emit))
  } catch (err) {
    emit({ type: 'error', runId, message: `Re-prescreen failed: ${err}` })
  }

  if (isPaused()) {
    emit({ type: 'progress', runId, found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing, reskipped })
    return { ...stats, reskipped, linkClosed: 0, paused: true }
  }

  try {
    ;({ closed: linkClosed } = await runLinkCheck(runId, emit))
  } catch (err) {
    emit({ type: 'error', runId, message: `Link check failed: ${err}` })
  }

  // Emit a final progress snapshot so the UI shows the complete tally
  emit({ type: 'progress', runId, found: stats.found, added: stats.added, skipped: stats.skipped, existing: stats.existing, reskipped, linkClosed })

  return { ...stats, reskipped, linkClosed, paused: false }
}
