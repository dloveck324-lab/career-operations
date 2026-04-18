import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getJob } from '../db/queries.js'
import { startAutofill } from '../autofill/autofill.js'

export async function applyRoutes(app: FastifyInstance) {
  app.post('/apply/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      showBrowser: z.boolean().optional().default(false),
    }).parse(req.body ?? {})

    const job = getJob(Number(id))
    if (!job) throw app.httpErrors.notFound('Job not found')

    const result = await startAutofill(job, { headless: !body.showBrowser })
    return result
  })
}
