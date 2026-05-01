import type { FastifyInstance } from 'fastify'
import { configExists, loadProfile } from '@job-pipeline/core'

const VALID_STEPS = new Set(['welcome', 'resume', 'profile', 'filters', 'done'])
const VALID_ACTIONS = new Set(['enter', 'next', 'back', 'skip', 'finish'])

export async function onboardingRoutes(app: FastifyInstance) {
  /**
   * Onboarding gate. Treats public-template placeholders ("Your Name",
   * "you@example.com") as not-yet-onboarded so a fresh clone gets the wizard
   * even though the *.example files were already renamed in place.
   */
  app.get('/onboarding/status', async () => {
    const cfg = configExists()
    const profile = loadProfile()
    const candidate = (profile?.candidate ?? {}) as Record<string, string>
    const fullName = (candidate.full_name ?? '').trim()
    const email = (candidate.email ?? '').trim()
    const isPlaceholderName = !fullName || /^your\s*name$/i.test(fullName)
    const isPlaceholderEmail = !email || /^you@example\.com$/i.test(email)
    const profileFilled = cfg.profile && !isPlaceholderName && !isPlaceholderEmail
    const cvFilled = cfg.cv
    return {
      needsOnboarding: !profileFilled || !cvFilled,
      profileFilled,
      cvFilled,
      filtersFilled: cfg.filters,
    }
  })

  /**
   * Funnel telemetry. The wizard fires {step, action} on every entry and
   * transition so the server log shows where users drop off. Local-first
   * app — there is no analytics provider, so the log line IS the report.
   */
  app.post('/onboarding/event', async (req, reply) => {
    const body = (req.body ?? {}) as { step?: unknown; action?: unknown }
    const step = typeof body.step === 'string' ? body.step : ''
    const action = typeof body.action === 'string' ? body.action : ''
    if (!VALID_STEPS.has(step) || !VALID_ACTIONS.has(action)) {
      return reply.code(400).send({ error: 'invalid step or action' })
    }
    app.log.info({ onboarding: { step, action } }, `onboarding ${step} ${action}`)
    return { ok: true }
  })
}
