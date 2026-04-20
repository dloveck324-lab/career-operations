import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assistantRegistry, type AssistantModel } from '../assistant/session.js'

const MODELS = ['haiku', 'sonnet', 'opus'] as const

export async function assistantRoutes(app: FastifyInstance) {
  /** Create a new assistant session. Spawns claude immediately. */
  app.post('/assistant/session', async (req) => {
    const body = z.object({
      model: z.enum(MODELS).optional().default('opus'),
    }).parse(req.body ?? {})
    const session = assistantRegistry.create(body.model as AssistantModel)
    return { sessionId: session.id, model: session.model }
  })

  /** Summary of a session. */
  app.get('/assistant/session/:sessionId', async (req) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = assistantRegistry.get(sessionId)
    if (!session) throw app.httpErrors.notFound('Session not found')
    return {
      id: session.id,
      model: session.model,
      status: session.status,
      startedAt: session.startedAt,
      claudeSessionId: session.claudeSessionId,
    }
  })

  /** SSE stream of session events. */
  app.get('/assistant/events/:sessionId', (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = assistantRegistry.get(sessionId)
    if (!session) {
      reply.code(404).send({ error: 'Session not found' })
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

    const unsubscribe = assistantRegistry.subscribe(sessionId, send)

    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { /* closed */ }
    }, 20_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  /** Send a user message into the running session. */
  app.post('/assistant/message', async (req) => {
    const body = z.object({
      sessionId: z.string().min(1),
      text: z.string().min(1),
    }).parse(req.body)
    const session = assistantRegistry.get(body.sessionId)
    if (!session) throw app.httpErrors.notFound('Session not found')
    const ok = assistantRegistry.sendMessage(body.sessionId, body.text)
    if (!ok) throw app.httpErrors.badRequest('Session is not accepting input (child closed)')
    return { ok: true }
  })

  /** Swap the underlying Claude model mid-session (resumes same transcript). */
  app.post('/assistant/session/:sessionId/model', async (req) => {
    const { sessionId } = req.params as { sessionId: string }
    const body = z.object({ model: z.enum(MODELS) }).parse(req.body)
    const session = assistantRegistry.get(sessionId)
    if (!session) throw app.httpErrors.notFound('Session not found')
    const ok = assistantRegistry.changeModel(sessionId, body.model as AssistantModel)
    if (!ok) throw app.httpErrors.badRequest('Could not change model')
    return { ok: true, model: body.model }
  })

  /** End a session. */
  app.delete('/assistant/session/:sessionId', async (req) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = assistantRegistry.get(sessionId)
    if (!session) throw app.httpErrors.notFound('Session not found')
    assistantRegistry.end(sessionId)
    return { ok: true }
  })
}
