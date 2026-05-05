import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// Mock the DB schema before importing anything that touches it
vi.mock('../db/schema.js', () => import('./helpers/testDb.js'))

// vi.mock factories are hoisted above any top-level code, so the mock
// stub has to be created via vi.hoisted() to be in scope.
const { evaluateJobMock } = vi.hoisted(() => ({ evaluateJobMock: vi.fn() }))

vi.mock('../claude/evaluator.js', async () => {
  // Keep classifyEvalError real — it's a pure function
  const real = await vi.importActual<typeof import('../claude/evaluator.js')>('../claude/evaluator.js')
  return {
    ...real,
    evaluateJob: evaluateJobMock,
  }
})

// Mock scan SSE broadcast (used inside evaluate.ts) so it doesn't no-op-fail
vi.mock('../routes/scan.js', () => ({
  broadcastScanEvent: vi.fn(),
  onScanComplete: vi.fn(),
  scanRoutes: async () => {},
}))

import Fastify, { type FastifyInstance } from 'fastify'
import sensible from '@fastify/sensible'
import { db } from './helpers/testDb.js'
import { upsertJob, getJob, MAX_EVAL_ATTEMPTS } from '../db/queries.js'
import { evaluateRoutes } from '../routes/evaluate.js'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(sensible)
  await app.register(evaluateRoutes, { prefix: '/api' })
  await app.ready()
})

afterAll(async () => { await app.close() })

beforeEach(() => {
  db.exec('DELETE FROM jobs; DELETE FROM evaluations;')
  evaluateJobMock.mockReset()
})

const seedJob = (overrides: Record<string, unknown> = {}) => upsertJob({
  source: 'greenhouse',
  external_id: `eval-test-${Math.random().toString(36).slice(2, 10)}`,
  url: 'https://example.com',
  company: 'Acme',
  title: 'Senior Engineer',
  location: 'Remote',
  remote_policy: 'remote',
  comp_text: '$150k',
  description_hash: undefined,
  status: 'prescreened',
  archetype: undefined,
  score: undefined,
  score_reason: undefined,
  skip_reason: undefined,
  evaluated_at: undefined,
  applied_at: undefined,
  ...overrides,
})

const fakeEvalResult = {
  model: 'haiku',
  score: 4,
  archetype: 'ai_product',
  cv_match: 4, north_star: 4, comp: 4, cultural_signals: 4,
  verdict_md: 'looks good',
  prompt_tokens: 0, completion_tokens: 0,
  raw_response: '{}',
  profile_variant: 'generic' as const,
}

// Wait for the fire-and-forget IIFE inside POST /evaluate to finish.
// We poll the job status because we can't easily await the async loop.
async function waitFor<T>(fn: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = fn()
    if (r !== undefined) return r
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('waitFor timed out')
}

describe('POST /api/evaluate — busy guard', () => {
  it('returns { queued: 0, reason: "busy" } when a run is already in flight', async () => {
    const { id } = seedJob()

    // First evaluator call hangs so the run stays "in flight"
    let resolveFirst!: () => void
    evaluateJobMock.mockImplementationOnce(() => new Promise<typeof fakeEvalResult>(r => {
      resolveFirst = () => r(fakeEvalResult)
    }))

    const first = await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ queued: 1 })

    // Second click while the first is still running — should be a no-op
    const second = await app.inject({ method: 'POST', url: '/api/evaluate', payload: {} })
    expect(second.json()).toEqual({ queued: 0, reason: 'busy' })

    // Let the first one finish so the global flag clears for subsequent tests
    resolveFirst()
    await waitFor(() => getJob(id)?.status === 'evaluated' ? true : undefined)
  })
})

describe('POST /api/evaluate — failure tracking', () => {
  it(`auto-skips a job after ${MAX_EVAL_ATTEMPTS} generic failures`, async () => {
    const { id } = seedJob()

    for (let i = 1; i <= MAX_EVAL_ATTEMPTS; i++) {
      evaluateJobMock.mockRejectedValueOnce(new Error(`fail ${i}`))
      await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
      // Wait for the IIFE to finish; signal is the eval_attempts increment.
      await waitFor(() => {
        const job = getJob(id)
        return job && job.eval_attempts === i ? true : undefined
      })
    }

    const final = getJob(id)!
    expect(final.status).toBe('skipped')
    expect(final.skip_reason).toMatch(/^eval_failed:/)
  })

  it('does NOT auto-skip on credit-shaped errors', async () => {
    const { id } = seedJob()

    for (let i = 1; i <= MAX_EVAL_ATTEMPTS; i++) {
      evaluateJobMock.mockRejectedValueOnce(new Error('Error: insufficient credit balance'))
      await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
      await waitFor(() => {
        const job = getJob(id)
        return job && job.eval_attempts === i ? true : undefined
      })
    }

    const final = getJob(id)!
    expect(final.eval_attempts).toBe(MAX_EVAL_ATTEMPTS)
    expect(final.status).toBe('prescreened')   // still retriable
    expect(final.eval_last_error_kind).toBe('credits')
  })

  it('resets eval_attempts to 0 on a successful evaluation', async () => {
    const { id } = seedJob()

    // Two failures
    evaluateJobMock.mockRejectedValueOnce(new Error('fail 1'))
    await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
    await waitFor(() => getJob(id)?.eval_attempts === 1 ? true : undefined)

    evaluateJobMock.mockRejectedValueOnce(new Error('fail 2'))
    await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
    await waitFor(() => getJob(id)?.eval_attempts === 2 ? true : undefined)

    // Success on the third attempt
    evaluateJobMock.mockResolvedValueOnce(fakeEvalResult)
    await app.inject({ method: 'POST', url: '/api/evaluate', payload: { ids: [id] } })
    await waitFor(() => getJob(id)?.status === 'evaluated' ? true : undefined)

    const job = getJob(id)!
    expect(job.eval_attempts).toBe(0)
    expect(job.eval_last_error).toBeNull()
    expect(job.score).toBe(4)
  })
})
