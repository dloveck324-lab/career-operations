import type { FastifyInstance } from 'fastify'
import { PinchTabClient } from '../autofill/pinchtab.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import { configExists } from '@job-pipeline/core'

const CONFIG_DIR = resolve(process.cwd(), '../../config')
mkdirSync(CONFIG_DIR, { recursive: true })

function configPath(name: string) {
  return resolve(CONFIG_DIR, name)
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings/status', async () => ({
    config: configExists(),
    pinchtab: await checkPinchTab(),
    claude: await checkClaudeCli(),
  }))

  app.get('/settings/profile', async () => {
    const path = configPath('profile.yml')
    if (!existsSync(path)) return null
    const profile = yaml.load(readFileSync(path, 'utf-8')) as Record<string, unknown>
    // Backfill candidate fields from cv.md if empty
    const candidate = (profile.candidate ?? {}) as Record<string, string>
    if (!candidate.full_name) {
      const cvPath = configPath('cv.md')
      if (existsSync(cvPath)) {
        const extracted = extractCvContact(readFileSync(cvPath, 'utf-8'))
        profile.candidate = { ...candidate, ...extracted }
        writeFileSync(path, yaml.dump(profile, { lineWidth: 120 }))
      }
    }
    return profile
  })

  app.put('/settings/profile', async (req) => {
    const body = req.body as Record<string, unknown>
    writeFileSync(configPath('profile.yml'), yaml.dump(body, { lineWidth: 120 }))
    // Sync contact fields → cv.md
    try {
      const cvPath = configPath('cv.md')
      if (existsSync(cvPath)) {
        const candidate = (body.candidate ?? {}) as Record<string, string>
        writeFileSync(cvPath, patchCvContact(readFileSync(cvPath, 'utf-8'), candidate))
      }
    } catch {}
    return { ok: true }
  })

  app.get('/settings/filters', async () => {
    const path = configPath('filters.yml')
    if (!existsSync(path)) return null
    return yaml.load(readFileSync(path, 'utf-8'))
  })

  app.put('/settings/filters', async (req) => {
    const body = req.body as object
    writeFileSync(configPath('filters.yml'), yaml.dump(body, { lineWidth: 120 }))
    return { ok: true }
  })

  app.get('/settings/cv', async () => {
    const path = configPath('cv.md')
    if (!existsSync(path)) return { content: null }
    return { content: readFileSync(path, 'utf-8') }
  })

  app.put('/settings/cv', async (req) => {
    const body = req.body as { content: string }
    writeFileSync(configPath('cv.md'), body.content)
    // Sync contact fields → profile.yml
    try {
      const profilePath = configPath('profile.yml')
      if (existsSync(profilePath)) {
        const profile = yaml.load(readFileSync(profilePath, 'utf-8')) as Record<string, unknown>
        const extracted = extractCvContact(body.content)
        profile.candidate = { ...(profile.candidate as object), ...extracted }
        writeFileSync(profilePath, yaml.dump(profile, { lineWidth: 120 }))
      }
    } catch {}
    return { ok: true }
  })

  app.get('/settings/field-mappings', async () => {
    const { getFieldMappings } = await import('../db/queries.js')
    return getFieldMappings()
  })

  app.delete('/settings/field-mappings/:id', async (req) => {
    const { id } = req.params as { id: string }
    const { db } = await import('../db/schema.js')
    db.prepare('DELETE FROM field_mappings WHERE id = ?').run(Number(id))
    return { ok: true }
  })
}

// ── CV ↔ Profile sync helpers ─────────────────────────────────────────────────

function extractCvContact(md: string): Record<string, string> {
  const lines = md.split('\n')
  const h1 = lines.find(l => l.startsWith('# '))
  const contactLine = lines.find(l => l.includes('|') && !l.trim().startsWith('#') && !l.trim().startsWith('---'))
  const name = h1 ? h1.slice(2).trim() : ''
  if (!contactLine) return { full_name: name }
  const [location = '', phone = '', email = '', linkedin = '', portfolio_url = ''] = contactLine.split('|').map(p => p.trim())
  return { full_name: name, location, phone, email, linkedin, portfolio_url }
}

function patchCvContact(md: string, candidate: Record<string, string>): string {
  const lines = md.split('\n')
  const h1Idx = lines.findIndex(l => l.startsWith('# '))
  if (h1Idx >= 0 && candidate.full_name) lines[h1Idx] = `# ${candidate.full_name}`
  const contactIdx = lines.findIndex(l => l.includes('|') && !l.trim().startsWith('#') && !l.trim().startsWith('---'))
  if (contactIdx >= 0) {
    const parts = [candidate.location, candidate.phone, candidate.email, candidate.linkedin, candidate.portfolio_url].filter(Boolean)
    if (parts.length) lines[contactIdx] = parts.join(' | ')
  }
  return lines.join('\n')
}

async function checkPinchTab(): Promise<{ ok: boolean; message?: string }> {
  const client = new PinchTabClient()
  const ok = await client.isReachable()
  return ok
    ? { ok: true }
    : { ok: false, message: 'PinchTab not reachable — run: pinchtab daemon install' }
}

async function checkClaudeCli(): Promise<{ ok: boolean; path?: string; message?: string }> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  try {
    const { stdout } = await execAsync('which claude')
    return { ok: true, path: stdout.trim() }
  } catch {
    return { ok: false, message: 'claude CLI not found in PATH' }
  }
}
