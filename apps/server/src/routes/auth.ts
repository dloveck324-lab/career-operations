import type { FastifyInstance } from 'fastify'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export async function authRoutes(app: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const allowedEmail = process.env.ALLOWED_EMAIL
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173'

  // Dev mode: no Google creds configured — auth is a no-op
  const devMode = !allowedEmail

  app.get('/auth/me', async (req, reply) => {
    if (devMode) return { email: 'dev' }
    const raw = req.cookies.auth_session
    if (!raw) return reply.status(401).send({ error: 'Not authenticated' })
    const { valid, value } = req.unsignCookie(raw)
    if (!valid || value !== allowedEmail) {
      reply.clearCookie('auth_session', { path: '/' })
      return reply.status(401).send({ error: 'Invalid session' })
    }
    return { email: value }
  })

  app.get('/auth/google', async (_req, reply) => {
    if (devMode || !clientId) return reply.status(501).send({ error: 'Auth not configured' })
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${allowedOrigin}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      prompt: 'select_account',
    })
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params}`)
  })

  app.get('/auth/google/callback', async (req, reply) => {
    if (devMode || !clientId || !clientSecret) return reply.redirect(`${allowedOrigin}/login?error=not_configured`)
    const { code, error } = req.query as { code?: string; error?: string }
    if (error || !code) return reply.redirect(`${allowedOrigin}/login?error=cancelled`)

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${allowedOrigin}/api/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      })
      const tokens = await tokenRes.json() as { id_token?: string; error?: string }
      if (!tokenRes.ok || !tokens.id_token) throw new Error(tokens.error ?? 'Token exchange failed')

      // Decode JWT payload (no need to verify sig — came directly from Google)
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()) as { email?: string }
      const email = payload.email

      if (!email || email !== allowedEmail) {
        return reply.redirect(`${allowedOrigin}/login?error=unauthorized`)
      }

      reply.setCookie('auth_session', email, {
        path: '/', httpOnly: true, secure: true, sameSite: 'lax', signed: true,
        maxAge: 30 * 24 * 60 * 60,
      })
      return reply.redirect(allowedOrigin)
    } catch (err) {
      app.log.error(err, 'Google OAuth callback error')
      return reply.redirect(`${allowedOrigin}/login?error=failed`)
    }
  })

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie('auth_session', { path: '/' })
    return { ok: true }
  })
}
