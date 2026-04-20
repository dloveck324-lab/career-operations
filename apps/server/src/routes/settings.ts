import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PinchTabClient } from '../autofill/pinchtab.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { configExists } from '@job-pipeline/core'
import { scheduler } from '../automation/scheduler.js'

const CONFIG_DIR = resolve(process.cwd(), '../../config')
mkdirSync(CONFIG_DIR, { recursive: true })

function configPath(name: string) {
  return resolve(CONFIG_DIR, name)
}

export interface ClaudeUsage {
  sessions: number
  messages: number
  sonnetTokens: number
  opusTokens: number
  haikuTokens: number
  totalTokens: number
  renewalDate: string
  // From claude.ai OAuth API — null if unavailable
  sessionUtilization: number | null
  weeklyUtilization: number | null
  weeklyResetsAt: string | null
  sonnetUtilization: number | null
  opusUtilization: number | null
}

interface OAuthWindow { utilization: number; resets_at?: string }
interface OAuthUsageData {
  five_hour?: OAuthWindow
  seven_day?: OAuthWindow
  seven_day_sonnet?: OAuthWindow
  seven_day_opus?: OAuthWindow
  [key: string]: unknown
}

let oauthCache: { data: OAuthUsageData; fetchedAt: number } | null = null

async function fetchOAuthUsage(): Promise<OAuthUsageData | null> {
  if (oauthCache && Date.now() - oauthCache.fetchedAt < 2 * 60 * 1000) return oauthCache.data
  try {
    const credsPath = join(homedir(), '.claude', '.credentials.json')
    if (!existsSync(credsPath)) return null
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
    const token = creds?.claude_ai_oauth?.accessToken
    if (!token) return null
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.114',
      },
    })
    if (!res.ok) return null
    const data = await res.json() as OAuthUsageData
    oauthCache = { data, fetchedAt: Date.now() }
    return data
  } catch { return null }
}

function getLocalUsage(): Omit<ClaudeUsage, 'weeklyUtilization' | 'weeklyResetsAt' | 'sonnetUtilization' | 'opusUtilization'> {
  const now = new Date()
  const renewalDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0]
  const empty = { sessions: 0, messages: 0, sonnetTokens: 0, opusTokens: 0, haikuTokens: 0, totalTokens: 0, renewalDate }

  const projectsDir = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsDir)) return empty

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  let sessions = 0, messages = 0, sonnetTokens = 0, opusTokens = 0, haikuTokens = 0

  function processFile(filePath: string) {
    try {
      const st = statSync(filePath)
      if (st.mtimeMs < sevenDaysAgo || st.size > 10 * 1024 * 1024) return
      sessions++
      for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj.type !== 'assistant') continue
          const msg = obj.message
          if (!msg?.usage) continue
          const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0)
          const model: string = msg.model ?? ''
          messages++
          if (model.includes('haiku')) haikuTokens += tokens
          else if (model.includes('opus')) opusTokens += tokens
          else sonnetTokens += tokens
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  try {
    for (const projectDir of readdirSync(projectsDir)) {
      const projectPath = join(projectsDir, projectDir)
      try {
        for (const entry of readdirSync(projectPath)) {
          const entryPath = join(projectPath, entry)
          if (entry.endsWith('.jsonl')) {
            processFile(entryPath)
          } else {
            const subagentsPath = join(entryPath, 'subagents')
            if (existsSync(subagentsPath)) {
              try {
                for (const sub of readdirSync(subagentsPath)) {
                  if (sub.endsWith('.jsonl')) processFile(join(subagentsPath, sub))
                }
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return { sessions, messages, sonnetTokens, opusTokens, haikuTokens, totalTokens: sonnetTokens + opusTokens + haikuTokens, renewalDate }
}

async function getClaudeUsage(): Promise<ClaudeUsage> {
  const [local, oauth] = await Promise.all([getLocalUsage(), fetchOAuthUsage()])
  return {
    ...local,
    sessionUtilization: oauth?.five_hour?.utilization ?? null,
    weeklyUtilization: oauth?.seven_day?.utilization ?? null,
    weeklyResetsAt: oauth?.seven_day?.resets_at ?? null,
    sonnetUtilization: oauth?.seven_day_sonnet?.utilization ?? null,
    opusUtilization: oauth?.seven_day_opus?.utilization ?? null,
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings/status', async () => ({
    config: configExists(),
    pinchtab: await checkPinchTab(),
    claude: await checkClaudeCli(),
  }))

  app.get('/settings/claude-usage', async () => await getClaudeUsage())

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
    // Re-seed field mappings so any newly-filled demographic/auth fields are
    // immediately available to Auto Fill without waiting for the next boot.
    try {
      const { loadProfile } = await import('@job-pipeline/core')
      const { seedFieldMappingsFromProfile } = await import('../db/queries.js')
      const p = loadProfile()
      if (p) seedFieldMappingsFromProfile(p)
    } catch { /* non-fatal */ }
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

  app.post('/settings/field-mappings/seed', async () => {
    const { seedFieldMappingsFromProfile } = await import('../db/queries.js')
    const { loadProfile } = await import('@job-pipeline/core')
    const profile = loadProfile()
    if (!profile) return { ok: false, seeded: 0, message: 'Profile not found' }
    const seeded = seedFieldMappingsFromProfile(profile)
    return { ok: true, seeded }
  })

  app.patch('/settings/field-mappings/:id', async (req) => {
    const { id } = req.params as { id: string }
    const { answer } = req.body as { answer: string }
    const { db } = await import('../db/schema.js')
    db.prepare('UPDATE field_mappings SET answer = ? WHERE id = ?').run(answer, Number(id))
    return { ok: true }
  })

  app.delete('/settings/field-mappings/:id', async (req) => {
    const { id } = req.params as { id: string }
    const { db } = await import('../db/schema.js')
    db.prepare('DELETE FROM field_mappings WHERE id = ?').run(Number(id))
    return { ok: true }
  })

  app.get('/settings/automation', async () => {
    return scheduler.getStatus()
  })

  app.put('/settings/automation', async (req) => {
    const body = z.object({
      autoScan: z.object({
        enabled: z.boolean(),
        intervalHours: z.number().int().min(1).max(168),
      }),
      autoEvaluate: z.object({
        enabled: z.boolean(),
        delayMinutes: z.number().int().min(1).max(1440),
        model: z.enum(['haiku', 'sonnet']),
      }),
      keepAwake: z.object({ enabled: z.boolean() }),
    }).parse(req.body)
    scheduler.configure(body)
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
