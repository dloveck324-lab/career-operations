import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getJob } from '../db/queries.js'
import { startAutofill, type AutofillModel } from '../autofill/autofill.js'
import { runRegistry } from '../autofill/runs.js'

const MODELS = ['haiku', 'sonnet', 'opus'] as const
const DEFAULT_CONCURRENCY = 3

export async function applyRoutes(app: FastifyInstance) {
  /** Start a single autofill run. Returns immediately with the runId. */
  app.post('/apply/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      model: z.enum(MODELS).optional().default('haiku'),
    }).parse(req.body ?? {})

    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')

    const { runId } = await startAutofill(job, { model: body.model })
    return { runId, jobId: job.id }
  })

  /** Bulk: queue autofill for many jobs, running at most `concurrency` at once. */
  app.post('/apply/bulk', async (req) => {
    const body = z.object({
      ids: z.array(z.number()).min(1),
      model: z.enum(MODELS).optional().default('haiku'),
      concurrency: z.number().int().min(1).max(6).optional().default(DEFAULT_CONCURRENCY),
    }).parse(req.body)

    const jobs = body.ids.map(getJob).filter(Boolean) as NonNullable<ReturnType<typeof getJob>>[]
    if (jobs.length === 0) throw app.httpErrors.badRequest('No valid jobs found')

    // Queue everything up-front so the UI can show all of them as queued
    const runs = jobs.map(j => ({ jobId: j.id, runId: runRegistry.create(j.id, body.model as AutofillModel).id }))

    // Kick off with bounded concurrency
    const queue = [...jobs]
    const startNext = async () => {
      const job = queue.shift()
      if (!job) return
      try {
        await startAutofill(job, { model: body.model as AutofillModel })
      } catch (err) {
        console.error(`[apply/bulk] failed to start job ${job.id}:`, err)
      }
    }

    for (let i = 0; i < Math.min(body.concurrency, jobs.length); i++) {
      void (async function worker() {
        // Each worker drains one job at a time; actual Claude runs go in background
        while (queue.length > 0) await startNext()
      })()
    }

    return { runs, model: body.model, concurrency: body.concurrency }
  })

  /** SSE: subscribe to all events for a run. */
  app.get('/apply/runs/:runId/events', (req, reply) => {
    const { runId } = req.params as { runId: string }
    const run = runRegistry.get(runId)
    if (!run) {
      reply.code(404).send({ error: 'Run not found' })
      return
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    reply.raw.write(': connected\n\n')

    const send = (ev: { id: number; kind: string; ts: number; data: unknown }) => {
      try {
        reply.raw.write(`event: ${ev.kind}\n`)
        reply.raw.write(`id: ${ev.id}\n`)
        reply.raw.write(`data: ${JSON.stringify({ ts: ev.ts, ...(ev.data as object) })}\n\n`)
      } catch { /* socket closed */ }
    }

    const unsubscribe = runRegistry.subscribe(runId, send)

    // Heartbeat every 20s so the browser keeps the connection open
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { /* closed */ }
    }, 20_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  /** Look up the current active run for a job (if any). */
  app.get('/apply/jobs/:id/run', async (req) => {
    const { id } = req.params as { id: string }
    const run = runRegistry.getByJob(Number(id))
    if (!run) return { run: null }
    return {
      run: {
        id: run.id,
        jobId: run.jobId,
        model: run.model,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        sessionId: run.sessionId,
        tabId: run.tabId,
      },
    }
  })

  /**
   * Inject a user message. If the run is still running, it's piped to the
   * live Claude child via stdin. If it has finished but we have the
   * sessionId, we spawn a fresh `claude --resume` one-shot so you can keep
   * chatting about the same application session after the fact.
   */
  app.post('/apply/runs/:runId/message', async (req) => {
    const { runId } = req.params as { runId: string }
    const body = z.object({ text: z.string().min(1) }).parse(req.body)
    const run = runRegistry.get(runId)
    if (!run) throw app.httpErrors.notFound('Run not found')
    const ok = runRegistry.sendMessage(runId, body.text)
    if (!ok) {
      if (!run.sessionId) throw app.httpErrors.badRequest('No session id to resume — run a fresh Auto Fill first')
      throw app.httpErrors.badRequest(`Run is ${run.status} and not resumable`)
    }
    return { ok: true }
  })

  /** Cancel a running autofill. */
  app.post('/apply/runs/:runId/cancel', async (req) => {
    const { runId } = req.params as { runId: string }
    const run = runRegistry.get(runId)
    if (!run) throw app.httpErrors.notFound('Run not found')
    runRegistry.cancel(runId)
    return { ok: true }
  })
}
