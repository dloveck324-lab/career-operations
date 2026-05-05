import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PinchTabClient } from '../autofill/pinchtab.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { homedir, tmpdir } from 'os'
import yaml from 'js-yaml'
import { configExists } from '@job-pipeline/core'
import { scheduler } from '../automation/scheduler.js'
import { execSync } from 'child_process'
import { createDecipheriv, pbkdf2Sync } from 'crypto'
import Database from 'better-sqlite3'

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

interface UsageWindow { utilization: number; resets_at?: string | null }
interface WebUsageData {
  five_hour?: UsageWindow | null
  seven_day?: UsageWindow | null
  seven_day_sonnet?: UsageWindow | null
  seven_day_opus?: UsageWindow | null
  [key: string]: unknown
}

let webUsageCache: { data: WebUsageData; fetchedAt: number } | null = null

function getChromeCookies(): Record<string, string> {
  try {
    // Require macOS + Chrome Profile 1 cookies
    const cookiesDb = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 1', 'Cookies')
    if (!existsSync(cookiesDb)) return {}

    const pwd = execSync('security find-generic-password -w -a Chrome -s "Chrome Safe Storage"', { timeout: 5000 })
      .toString().trim()
    const aesKey = pbkdf2Sync(Buffer.from(pwd), Buffer.from('saltysalt'), 1003, 16, 'sha1')

    const tmp = join(tmpdir(), `chrome_cookies_${Date.now()}.db`)
    copyFileSync(cookiesDb, tmp)

    const db = new Database(tmp, { readonly: true })
    const rows = db.prepare(
      "SELECT name, encrypted_value, value FROM cookies WHERE host_key LIKE '%claude.ai%'"
    ).all() as Array<{ name: string; encrypted_value: Buffer; value: string }>
    db.close()
    unlinkSync(tmp)

    const result: Record<string, string> = {}
    for (const row of rows) {
      try {
        const enc = Buffer.from(row.encrypted_value)
        let val: string
        if (enc.slice(0, 3).toString() === 'v10') {
          const decipher = createDecipheriv('aes-128-cbc', aesKey, Buffer.alloc(16, 32))
          decipher.setAutoPadding(false)
          const dec = Buffer.concat([decipher.update(enc.slice(3)), decipher.final()])
          const text = dec.toString('latin1')
          // Strip non-printable bytes; extract printable segments
          val = text.replace(/[\x00-\x1f\x7f-\xff]/g, '\x00').split('\x00').filter(s => s.length > 3).join('')
        } else {
          val = row.value || ''
        }
        if (row.name === 'sessionKey') {
          const idx = val.indexOf('sk-ant-')
          if (idx >= 0) val = val.slice(idx).replace(/[\x00-\x1f]+$/, '')
        }
        if (val) result[row.name] = val
      } catch { /* skip malformed cookie */ }
    }
    return result
  } catch { return {} }
}

async function fetchWebUsage(): Promise<WebUsageData | null> {
  if (webUsageCache && Date.now() - webUsageCache.fetchedAt < 2 * 60 * 1000) return webUsageCache.data
  try {
    const cookies = getChromeCookies()
    if (!cookies['sessionKey']) return null

    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    const headers = {
      Cookie: cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://claude.ai',
      Referer: 'https://claude.ai/',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    }

    const orgsRes = await fetch('https://claude.ai/api/organizations', { headers })
    if (!orgsRes.ok) return null
    const orgs = await orgsRes.json() as Array<{ uuid: string }>
    const orgId = orgs[0]?.uuid
    if (!orgId) return null

    const usageRes = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, { headers })
    if (!usageRes.ok) return null
    const data = await usageRes.json() as WebUsageData
    webUsageCache = { data, fetchedAt: Date.now() }
    return data
  } catch { return null }
}

function getLocalUsage(): Omit<ClaudeUsage, 'sessionUtilization' | 'weeklyUtilization' | 'weeklyResetsAt' | 'sonnetUtilization' | 'opusUtilization'> {
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
  const [local, web] = await Promise.all([getLocalUsage(), fetchWebUsage()])
  return {
    ...local,
    sessionUtilization: web?.five_hour?.utilization ?? null,
    weeklyUtilization: web?.seven_day?.utilization ?? null,
    weeklyResetsAt: web?.seven_day?.resets_at ?? null,
    sonnetUtilization: web?.seven_day_sonnet?.utilization ?? null,
    opusUtilization: web?.seven_day_opus?.utilization ?? null,
  }
}

export interface SlashCommand {
  name: string
  description: string
  source: 'project' | 'global' | 'builtin'
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact conversation context to save tokens', source: 'builtin' },
  { name: 'clear', description: 'Clear conversation history and start fresh', source: 'builtin' },
  { name: 'help', description: 'Show available commands and usage', source: 'builtin' },
  { name: 'resume', description: 'Resume a previous session by session ID', source: 'builtin' },
]

function readSkillsFromDir(dir: string, source: 'project' | 'global'): SlashCommand[] {
  if (!existsSync(dir)) return []
  const commands: SlashCommand[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const skillFile = join(dir, entry, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      try {
        const content = readFileSync(skillFile, 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (!fmMatch) continue
        const fm = yaml.load(fmMatch[1]) as Record<string, unknown>
        if (fm['user-invocable'] !== true) continue
        const name = String(fm.name ?? entry)
        const description = String(fm.description ?? '')
        commands.push({ name, description, source })
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dir */ }
  return commands
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings/status', async () => ({
    config: configExists(),
    pinchtab: await checkPinchTab(),
    claude: await checkClaudeCli(),
  }))

  app.get('/settings/claude-usage', async () => await getClaudeUsage())

  app.get('/settings/slash-commands', async (): Promise<SlashCommand[]> => {
    const projectSkillsDir = resolve(process.cwd(), '../../.claude/skills')
    const globalSkillsDir = join(homedir(), '.claude', 'skills')
    return [
      ...BUILTIN_COMMANDS,
      ...readSkillsFromDir(projectSkillsDir, 'project'),
      ...readSkillsFromDir(globalSkillsDir, 'global'),
    ]
  })

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
    // Shallow-merge with the on-disk profile: top-level keys present in `body`
    // replace their counterparts; keys absent from `body` are preserved.
    // Without this, two tabs (e.g. Profile + Scan) racing to save partial
    // profiles would overwrite each other's sections. See the SaveBar/auto-
    // save flow in apps/web/src/components/{ProfileForm,ScanFiltersForm}.tsx.
    const path = configPath('profile.yml')
    const existing = existsSync(path)
      ? ((yaml.load(readFileSync(path, 'utf-8')) as Record<string, unknown> | null) ?? {})
      : {}
    const merged = { ...existing, ...body }
    writeFileSync(path, yaml.dump(merged, { lineWidth: 120 }))
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

  /**
   * Append terms to a specific prescreen blocklist in profile.yml.
   * Body: { list: 'blocklist_requirements' | 'blocklist_titles' | 'location_blocklist', terms: string[] }
   * Dedupes — won't add a term that already exists in the list.
   */
  app.patch('/settings/profile/blocklist', async (req) => {
    const body = z.object({
      list: z.enum(['blocklist_requirements', 'blocklist_titles', 'location_blocklist']),
      terms: z.array(z.string().min(1)).min(1),
    }).parse(req.body)

    const path = configPath('profile.yml')
    const existing = existsSync(path)
      ? ((yaml.load(readFileSync(path, 'utf-8')) as Record<string, unknown> | null) ?? {})
      : {}

    const prescreen = (existing.prescreen ?? {}) as Record<string, unknown>
    const currentList: string[] = Array.isArray(prescreen[body.list]) ? prescreen[body.list] as string[] : []
    const toAdd = body.terms.filter(t => !currentList.includes(t))
    const merged = {
      ...existing,
      prescreen: { ...prescreen, [body.list]: [...currentList, ...toAdd] },
    }
    writeFileSync(path, yaml.dump(merged, { lineWidth: 120 }))
    return { ok: true, added: toAdd.length, skipped: body.terms.length - toAdd.length }
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

  /**
   * Bulk-import portal entries. Body: { text: string, format?: 'yaml' | 'json' }.
   * Accepts either a `portals: [...]` doc or a bare array. Each entry must have
   * { name, type, company_id }. Dedupes against existing entries by (type, company_id).
   * Appends to filters.yml in place; returns counts.
   */
  app.post('/settings/portals/import', async (req) => {
    const body = req.body as { text?: string; format?: 'yaml' | 'json' }
    if (!body?.text?.trim()) throw app.httpErrors.badRequest('text is required')

    let parsed: unknown
    try {
      parsed = body.format === 'json' ? JSON.parse(body.text) : yaml.load(body.text)
    } catch (err) {
      throw app.httpErrors.badRequest(`Parse error: ${(err as Error).message}`)
    }

    const incoming: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { portals?: unknown[] })?.portals)
        ? (parsed as { portals: unknown[] }).portals
        : []
    if (incoming.length === 0) throw app.httpErrors.badRequest('No portal entries found in input')

    const VALID_TYPES = new Set(['greenhouse', 'ashby', 'lever', 'workday', 'custom'])
    const valid: Array<Record<string, unknown>> = []
    const invalid: Array<{ entry: unknown; reason: string }> = []
    for (const e of incoming) {
      if (!e || typeof e !== 'object') { invalid.push({ entry: e, reason: 'not an object' }); continue }
      const r = e as Record<string, unknown>
      if (typeof r.name !== 'string' || !r.name.trim()) { invalid.push({ entry: e, reason: 'missing name' }); continue }
      if (typeof r.type !== 'string' || !VALID_TYPES.has(r.type)) { invalid.push({ entry: e, reason: `invalid type (must be one of ${[...VALID_TYPES].join(', ')})` }); continue }
      if (r.type !== 'custom' && (typeof r.company_id !== 'string' || !r.company_id.trim())) {
        invalid.push({ entry: e, reason: 'company_id required for non-custom portals' }); continue
      }
      valid.push({
        name: r.name,
        type: r.type,
        company_id: r.company_id ?? '',
        url: typeof r.url === 'string' ? r.url : '',
        notes: typeof r.notes === 'string' ? r.notes : '',
        enabled: r.enabled !== false,
      })
    }

    const path = configPath('filters.yml')
    const existing = existsSync(path)
      ? (yaml.load(readFileSync(path, 'utf-8')) as { portals?: Record<string, unknown>[] } | null) ?? {}
      : {}
    const portals = existing.portals ?? []
    const existingKeys = new Set(portals.map(p => `${p.type as string}:${(p.company_id as string) ?? ''}`))

    const added: Record<string, unknown>[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    for (const v of valid) {
      const k = `${v.type}:${v.company_id ?? ''}`
      if (existingKeys.has(k)) { skipped.push({ name: v.name as string, reason: 'duplicate (type+company_id already exists)' }); continue }
      existingKeys.add(k)
      portals.push(v)
      added.push(v)
    }

    const merged = { ...existing, portals }
    writeFileSync(path, yaml.dump(merged, { lineWidth: 120 }))

    return {
      added: added.length,
      skipped: skipped.length,
      invalid: invalid.length,
      detail: { added: added.map(a => a.name), skipped, invalid },
    }
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
