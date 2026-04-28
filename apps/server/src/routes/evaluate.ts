import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getJobs, getJob, getJobsByIds, getJobContent, getPrescreenedCompanies, updateJobStatus, saveEvaluation } from '../db/queries.js'
import { evaluateJob } from '../claude/evaluator.js'
import { broadcastScanEvent } from './scan.js'

const sseClients = new Set<FastifyReply>()
let pauseRequested = false
let evalAbortController: AbortController | null = null

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
    broadcastEvalEvent({ type: 'eval_queued', jobIds: jobs.map(j => j.id) })

    ;(async () => {
      let done = 0
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
          saveEvaluation({ job_id: job.id, ...result })
          // Ambiguous jobs run dual eval — persist the secondary result too.
          if (result.dual_secondary) saveEvaluation({ job_id: job.id, ...result.dual_secondary })
          updateJobStatus(job.id, 'evaluated', {
            score: result.score,
            score_reason: result.verdict_md?.slice(0, 1000),
            archetype: result.archetype ?? job.archetype ?? undefined,
            evaluated_at: new Date().toISOString(),
          })
          broadcastEvalEvent({ type: 'eval_done', jobId: job.id, score: result.score })
        } catch (err) {
          if (signal.aborted) { broadcastEvalEvent({ type: 'eval_paused', done }); return }
          broadcastEvalEvent({ type: 'eval_error', jobId: job.id, message: String(err) })
        }
        done++
      }
      broadcastEvalEvent({ type: 'eval_all_done', total: jobs.length })
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
