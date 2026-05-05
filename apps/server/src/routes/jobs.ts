import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getJobs, getJob, updateJobStatus, getJobStats, getJobContent, requeueJobs,
  bulkUpdateStatus, setSkipTags, getSkipPatterns,
  type JobStatus,
} from '../db/queries.js'
import { extractSkipTags } from '../claude/skip-tagger.js'

const JOB_STATUSES: JobStatus[] = ['scanned', 'prescreened', 'evaluated', 'ready_to_submit', 'applied', 'interview', 'completed', 'skipped']

export async function jobRoutes(app: FastifyInstance) {
  app.get('/jobs', async (req) => {
    const query = req.query as { status?: string }
    const status = query.status as JobStatus | undefined
    if (status && !JOB_STATUSES.includes(status)) {
      throw app.httpErrors.badRequest(`Invalid status: ${status}`)
    }
    return getJobs(status)
  })

  app.get('/jobs/stats', async () => getJobStats())

  app.get('/jobs/:id', async (req) => {
    const { id } = req.params as { id: string }
    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')
    const content = getJobContent(Number(id))
    return { ...job, content }
  })

  app.post('/jobs/bulk-status', async (req) => {
    const body = z.object({
      ids: z.array(z.number()),
      status: z.enum(['scanned', 'prescreened', 'evaluated', 'ready_to_submit', 'applied', 'interview', 'completed', 'skipped']),
      skip_reason: z.string().optional(),
    }).parse(req.body)

    const count = bulkUpdateStatus(body.ids, body.status as JobStatus, body.skip_reason)

    // Tag extraction is intentionally fire-and-forget. The Haiku call takes
    // ~5 seconds; we don't want to block the user on it. Patterns will pick up
    // the new tags on the next skipPatterns() fetch.
    if (body.status === 'skipped' && body.skip_reason) {
      const reason = body.skip_reason
      const ids = body.ids
      void extractSkipTags(reason)
        .then(tags => { for (const id of ids) setSkipTags(id, tags) })
        .catch(() => { /* swallow — tag extraction failure must not bubble */ })
    }

    return { count }
  })

  app.post('/jobs/requeue', async (req) => {
    const body = z.object({ ids: z.array(z.number()).optional() }).parse(req.body ?? {})
    const count = requeueJobs(body.ids)
    return { count }
  })

  app.patch('/jobs/:id/status', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      status: z.enum(['scanned', 'prescreened', 'evaluated', 'ready_to_submit', 'applied', 'interview', 'completed', 'skipped']),
      skip_reason: z.string().optional(),
    }).parse(req.body)

    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')

    const extra: Record<string, unknown> = {}
    if (body.status === 'applied') extra.applied_at = new Date().toISOString()
    if (body.skip_reason) extra.skip_reason = body.skip_reason

    updateJobStatus(Number(id), body.status, extra as Parameters<typeof updateJobStatus>[2])

    // Fire-and-forget tag extraction (see /bulk-status note). Returning
    // immediately keeps the UI snappy; tags appear in the patterns panel
    // a few seconds later when extraction completes.
    if (body.status === 'skipped' && body.skip_reason) {
      const reason = body.skip_reason
      const jobId = Number(id)
      void extractSkipTags(reason)
        .then(tags => setSkipTags(jobId, tags))
        .catch(() => { /* swallow — tag extraction failure must not bubble */ })
    }

    return { ok: true }
  })

  // Aggregates skip_tags across all manually-skipped jobs and returns patterns
  // with count ≥ 2 so the UI can suggest blocklist additions.
  app.get('/jobs/skip-patterns', async () => getSkipPatterns())
}
