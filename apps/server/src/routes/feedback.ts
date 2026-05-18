import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  insertEvalFeedback,
  getFeedbackForJob,
  getRecentLessons,
  getLatestEvaluationId,
} from '../db/queries.js'

const feedbackBody = z.object({
  evaluation_id: z.number().int().positive().optional(),
  flag_type: z.enum(['red', 'green', 'verdict', 'score']),
  flag_text: z.string().min(1).max(500),
  correction: z.string().max(1000).optional(),
})

export async function feedbackRoutes(app: FastifyInstance) {
  /**
   * POST /api/jobs/:jobId/feedback — submit feedback on the latest evaluation
   * for a job. If `evaluation_id` is omitted, we attach feedback to the most
   * recent eval (the typical case — the drawer always shows the latest).
   */
  app.post('/jobs/:jobId/feedback', async (req) => {
    const { jobId } = req.params as { jobId: string }
    const body = feedbackBody.parse(req.body)
    const job_id = Number(jobId)
    const evaluation_id = body.evaluation_id ?? getLatestEvaluationId(job_id)
    if (!evaluation_id) throw app.httpErrors.notFound('No evaluation found for this job')
    const id = insertEvalFeedback({
      evaluation_id,
      job_id,
      flag_type: body.flag_type,
      flag_text: body.flag_text,
      correction: body.correction,
    })
    return { ok: true, id, evaluation_id }
  })

  /** Feedback rows for a job — used to mark already-flagged items in the UI. */
  app.get('/jobs/:jobId/feedback', async (req) => {
    const { jobId } = req.params as { jobId: string }
    return getFeedbackForJob(Number(jobId))
  })

  /**
   * Recent lessons (deduped corrections) used by the evaluator prompt. Exposed
   * so the UI can show "N lessons active" and so we can curl-verify the loop.
   */
  app.get('/evaluations/lessons', async (req) => {
    const q = req.query as { limit?: string }
    const limit = Math.max(1, Math.min(50, Number(q.limit ?? '20') || 20))
    return getRecentLessons(limit)
  })
}
