import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

vi.mock('@job-pipeline/core', () => ({
  configExists: () => ({ profile: true, filters: true, cv: true }),
  loadProfile: () => ({ candidate: { full_name: 'Your Name', email: 'you@example.com' } }),
}))

import { onboardingRoutes } from '../routes/onboarding.js'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(onboardingRoutes, { prefix: '/api' })
  await app.ready()
})

afterAll(async () => { await app.close() })

describe('GET /api/onboarding/status', () => {
  it('flags placeholder profile values as not-yet-onboarded', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/onboarding/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { needsOnboarding: boolean; profileFilled: boolean; cvFilled: boolean }
    expect(body.needsOnboarding).toBe(true)
    expect(body.profileFilled).toBe(false)
    expect(body.cvFilled).toBe(true)
  })
})

describe('POST /api/onboarding/event', () => {
  it('accepts a valid step + action pair', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/event',
      payload: { step: 'resume', action: 'enter' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects unknown step names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/event',
      payload: { step: 'wat', action: 'enter' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects unknown action names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/event',
      payload: { step: 'resume', action: 'teleport' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an empty body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/onboarding/event',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
