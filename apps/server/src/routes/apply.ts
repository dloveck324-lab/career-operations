import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getJob } from '../db/queries.js'
import { startAutofill } from '../autofill/autofill.js'

const MODELS = ['haiku', 'sonnet', 'opus'] as const

export async function applyRoutes(app: FastifyInstance) {
  app.post('/apply/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      model: z.enum(MODELS).optional().default('haiku'),
    }).parse(req.body ?? {})

    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')

    const result = await startAutofill(job, { model: body.model })
    return result
  })
}
