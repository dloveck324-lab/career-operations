import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  getJobs, getJob, getJobsByIds, getJobContent, getPrescreenedCompanies,
  updateJobStatus, saveEvaluation, commitEvaluation, recordEvalFailure,
} from '../db/queries.js'
import { evaluateJob, classifyEvalError } from '../claude/evaluator.js'
import { broadcastScanEvent } from './scan.js'

const sseClients = new Set<FastifyReply>()
let pauseRequested = false
let evalAbortController: AbortController | null = null
// In-flight guard. While true, a second POST /evaluate is a no-op so users
// can't accidentally abort their own running batch (which previously caused
// a save-then-status race that left jobs orphaned in `prescreened`).
let evalRunning = false

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
}

const MAX_BULK_JOBS = 100

function broadcastEvalEvent(event: object) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    try { client.raw.write(data) } catch { sseClients.delete(client) }
  }
  broadcastScanEvent(event as Parameters<typeof broadcastScanEvent>[0])
}

export async function evaluateRoutes(app: FastifyInstance) {
  app.get('/evaluate/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()
    sseClients.add(reply)
    // Tell this client what the current batch state is so a page reload
    // mid-run leaves the EVALUATE button correctly disabled.
    try {
      reply.raw.write(`data: ${JSON.stringify({ type: 'eval_state', running: evalRunning })}\n\n`)
    } catch { /* client dropped between header flush and write */ }
    req.raw.on('close', () => sseClients.delete(reply))
    const keepAlive = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { clearInterval(keepAlive) }
    }, 15_000)
    req.raw.on('close', () => clearInterval(keepAlive))
    await new Promise(() => {})
  })

  app.get('/evaluate/companies', async () => {
    return getPrescreenedCompanies()
  })

  app.post('/evaluate/pause', async () => {
    pauseRequested = true
    evalAbortController?.abort()
    return { ok: true }
  })

  app.post('/evaluate', async (req) => {
    if (evalRunning) {
      // Don't kill the in-flight run — that's the bug we're fixing. The
      // user can call /evaluate/pause if they really want to interrupt.
      return { queued: 0, reason: 'busy' as const }
    }

    const body = z.object({
      model: z.enum(['haiku', 'sonnet']).optional(),
      limit: z.number().int().min(0).optional(),
      company: z.string().optional(),
      ids: z.array(z.number()).optional(),
    }).parse(req.body ?? {})

    let jobs = body.ids?.length
      ? getJobsByIds(body.ids)
      : getJobs('prescreened')

    if (!body.ids?.length) {
      if (body.company) jobs = jobs.filter(j => j.company === body.company)
      if (body.limit && body.limit > 0) jobs = jobs.slice(0, body.limit)
    }
    if (jobs.length > MAX_BULK_JOBS) jobs = jobs.slice(0, MAX_BULK_JOBS)
    if (jobs.length === 0) return { queued: 0 }

    const modelOverride = body.model ? MODEL_MAP[body.model] : undefined
    pauseRequested = false
    evalAbortController = new AbortController()
    const { signal } = evalAbortController
    evalRunning = true
    broadcastEvalEvent({ type: 'eval_state', running: true })
    broadcastEvalEvent({ type: 'eval_queued', jobIds: jobs.map(j => j.id) })

    ;(async () => {
      let done = 0
      try {
        for (const job of jobs) {
          if (pauseRequested || signal.aborted) {
            pauseRequested = false
            broadcastEvalEvent({ type: 'eval_paused', done })
            return
          }
          try {
            broadcastEvalEvent({ type: 'eval_start', jobId: job.id, company: job.company, title: job.title, total: jobs.length, done })
            const content = getJobContent(job.id)
            const result = await evaluateJob(job, content?.cleaned_md ?? content?.raw_text ?? '', { depth: 'quick', modelOverride, signal })
            if (signal.aborted) { broadcastEvalEvent({ type: 'eval_paused', done }); return }
            // Atomic save+update — eliminates the orphan-row race where an
            // abort signal between the writes left a job with a stored
            // evaluation but status still 'prescreened'.
            commitEvaluation({
              evaluation: { job_id: job.id, ...result },
              secondary: result.dual_secondary ? { job_id: job.id, ...result.dual_secondary } : undefined,
              jobId: job.id,
              statusUpdate: {
                status: 'evaluated',
                score: result.score,
                score_reason: result.verdict_md?.slice(0, 1000),
                archetype: result.archetype ?? job.archetype ?? undefined,
                evaluated_at: new Date().toISOString(),
              },
            })
            broadcastEvalEvent({ type: 'eval_done', jobId: job.id, score: result.score })
          } catch (err) {
            if (signal.aborted) { broadcastEvalEvent({ type: 'eval_paused', done }); return }
            const msg = String(err)
            const kind = classifyEvalError(msg)
            const { attempts, skipped } = recordEvalFailure(job.id, msg, { kind })
            broadcastEvalEvent({ type: 'eval_error', jobId: job.id, message: msg, kind, attempts, skipped })
            // Surface a clear, actionable signal for credit exhaustion
            // (and rate limits / auth — also infra-level). Front-end shows
            // a persistent banner with a link to the billing console.
            if (kind === 'credits' || kind === 'rate_limit' || kind === 'auth') {
              broadcastEvalEvent({ type: 'eval_credits_low', jobId: job.id, message: msg, kind })
            }
          }
          done++
        }
        broadcastEvalEvent({ type: 'eval_all_done', total: jobs.length })
      } finally {
        evalRunning = false
        broadcastEvalEvent({ type: 'eval_state', running: false })
      }
    })()

    return { queued: jobs.length }
  })

  app.post('/evaluate/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ deep: z.boolean().optional() }).parse(req.body ?? {})
    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')
    const content = getJobContent(Number(id))
    const result = await evaluateJob(job, content?.cleaned_md ?? content?.raw_text ?? '', { depth: body.deep ? 'deep' : 'quick' })
    saveEvaluation({ job_id: job.id, ...result })
    if (result.dual_secondary) saveEvaluation({ job_id: job.id, ...result.dual_secondary })
    updateJobStatus(job.id, 'evaluated', {
      score: result.score,
      score_reason: result.verdict_md?.slice(0, 1000),
      evaluated_at: new Date().toISOString(),
    })
    return result
  })
}
