import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadCv, type CandidateProfile } from '@job-pipeline/core'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { updateJobStatus, getAllFieldMappings } from '../db/queries.js'
import { runRegistry, type Run } from './runs.js'
import type { Job } from '../db/schema.js'

type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'generic'

function detectAts(url: string): Ats {
  try {
    const h = new URL(url).hostname.toLowerCase()
    if (h.endsWith('greenhouse.io')) return 'greenhouse'
    if (h.endsWith('jobs.lever.co')) return 'lever'
    if (h.endsWith('jobs.ashbyhq.com')) return 'ashby'
    if (h.includes('myworkdayjobs.com') || h.includes('workday.com')) return 'workday'
    return 'generic'
  } catch { return 'generic' }
}

function readSkillFile(relPath: string): string {
  // Resolve relative to project root (server is started from project root per package.json scripts).
  const abs = resolve(process.cwd(), relPath)
  try {
    if (existsSync(abs)) return readFileSync(abs, 'utf8').trim()
  } catch { /* noop */ }
  return ''
}

function resolveCvPdfPath(profile: ReturnType<typeof loadProfile>): string | null {
  // Priority: profile.candidate.cv_pdf_path → config/cv.pdf → config/resume.pdf
  const custom = (profile?.candidate as Record<string, unknown> | undefined)?.cv_pdf_path
  if (typeof custom === 'string' && custom.trim()) {
    const abs = resolve(process.cwd(), custom)
    if (existsSync(abs)) return abs
  }
  for (const candidate of ['config/cv.pdf', 'config/resume.pdf']) {
    const abs = resolve(process.cwd(), candidate)
    if (existsSync(abs)) return abs
  }
  return null
}

export type AutofillModel = 'haiku' | 'sonnet' | 'opus'

const MODEL_IDS: Record<AutofillModel, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

const CLAUDE_TIMEOUT_MS: Record<AutofillModel, number> = {
  haiku: 4 * 60_000,
  sonnet: 8 * 60_000,
  opus: 12 * 60_000,
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const QUICKFILL_SCRIPT = resolve(__dirname, 'quickfill.sh')

/**
 * Kick off an autofill run. Returns immediately with the runId; the caller
 * should subscribe to /apply/runs/:runId/events to watch progress.
 */
export async function startAutofill(
  job: Job,
  opts: { model?: AutofillModel } = {},
): Promise<{ runId: string }> {
  const model: AutofillModel = opts.model ?? 'haiku'
  const run = runRegistry.create(job.id, model)

  // Fire-and-forget. All progress is surfaced via runRegistry events.
  void runOrchestration(run, job).catch((err) => {
    runRegistry.publish(run.id, 'error', { message: String((err as Error)?.message ?? err) })
    runRegistry.setStatus(run.id, 'failed')
  })

  return { runId: run.id }
}

async function runOrchestration(run: Run, job: Job): Promise<void> {
  const client = new PinchTabClient()
  console.log(`[autofill] start run=${run.id} job=${job.id} model=${run.model} url=${job.url}`)

  if (!(await client.isReachable())) {
    runRegistry.publish(run.id, 'error', { message: 'PinchTab not reachable — run: pinchtab daemon install' })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  try {
    const instanceUrl = await client.ensureInstance('default', false)
    runRegistry.publish(run.id, 'status', { stage: 'browser_ready', instanceUrl })
  } catch (err) {
    runRegistry.publish(run.id, 'error', { message: `PinchTab instance start failed: ${(err as Error).message}` })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  // Create a dedicated tab for this run so parallel runs don't collide.
  const applyUrl = toApplyUrl(job.url)
  let tabId: string
  try {
    tabId = await client.navigateNewTab(applyUrl)
    runRegistry.setTabId(run.id, tabId)
    // navigateNewTab opens a new tab but may not navigate it — drive to the URL explicitly.
    await client.navigate(applyUrl)
    // Wait for the page to leave about:blank. Retry once if the first attempt times out.
    let loadedUrl = await client.waitForLoad(12_000)
    if (!loadedUrl) {
      runRegistry.publish(run.id, 'status', { stage: 'nav_retry', url: applyUrl })
      await client.navigate(applyUrl)
      loadedUrl = await client.waitForLoad(10_000)
    }
    if (!loadedUrl) {
      throw new Error(`Page did not load after navigation: ${applyUrl}`)
    }
    runRegistry.publish(run.id, 'status', { stage: 'tab_opened', tabId, url: loadedUrl })
  } catch (err) {
    runRegistry.publish(run.id, 'error', { message: `Failed to open tab: ${(err as Error).message}` })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  const profile = loadProfile()
  const cv = loadCv()
  if (!profile) {
    runRegistry.publish(run.id, 'error', { message: 'No candidate profile loaded (config/profile.yml)' })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  const mappings = getAllFieldMappings()
  const ats = detectAts(job.url)
  const prompt = buildAgentPrompt(job, profile, cv, tabId, mappings, ats)
  runRegistry.publish(run.id, 'prompt', { text: prompt, model: MODEL_IDS[run.model], ats })

  await spawnClaudeAgent(run, prompt, tabId, job)
}

async function spawnClaudeAgent(run: Run, prompt: string, tabId: string, job: Job): Promise<void> {
  return new Promise((resolveFn) => {
    const args = [
      '--model', MODEL_IDS[run.model],
      '--dangerously-skip-permissions',
      '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
    ]
    const child = spawn('claude', args, {
      env: { ...process.env, PINCHTAB_TAB: tabId },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ReturnType<typeof spawn> & { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream }

    runRegistry.attachChild(run.id, child as Parameters<typeof runRegistry.attachChild>[1])
    console.log(`[autofill] run=${run.id} claude pid=${child.pid}`)

    // Send the initial prompt as the first user message
    const initial = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }
    try { child.stdin.write(JSON.stringify(initial) + '\n') } catch { /* handled below */ }

    const timer = setTimeout(() => {
      runRegistry.publish(run.id, 'error', { message: `Claude agent timed out after ${CLAUDE_TIMEOUT_MS[run.model] / 1000}s` })
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, CLAUDE_TIMEOUT_MS[run.model])

    let buf = ''
    let finalText = ''
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line) as {
            type?: string
            subtype?: string
            session_id?: string
            message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> }
            result?: string
          }
          if (ev.type === 'system' && ev.subtype === 'init') {
            if (ev.session_id) {
              runRegistry.setSessionId(run.id, ev.session_id)
              runRegistry.publish(run.id, 'session', { sessionId: ev.session_id })
            }
          } else if (ev.type === 'assistant' && ev.message?.content) {
            for (const content of ev.message.content) {
              if (content.type === 'text' && content.text?.trim()) {
                runRegistry.publish(run.id, 'thinking', { text: content.text })
                finalText += content.text
              }
              if (content.type === 'tool_use') {
                const input = content.input ?? {}
                let hint = ''
                if (typeof input.command === 'string') hint = input.command.slice(0, 200)
                else if (typeof input.url === 'string') hint = input.url
                runRegistry.publish(run.id, 'tool', { name: content.name, hint, input })
              }
            }
          } else if (ev.type === 'result' && ev.result) {
            finalText = ev.result
            runRegistry.publish(run.id, 'result', { text: finalText })
          }
          // Opportunistic compaction check after each event batch
          runRegistry.maybeCompact(run.id)
        } catch { /* non-JSON line, ignore */ }
      }
    })

    child.stderr.on('data', (c: Buffer) => {
      const text = c.toString().trim().slice(0, 400)
      if (text) {
        runRegistry.publish(run.id, 'error', { source: 'stderr', message: text })
        console.error(`[autofill run=${run.id} stderr] ${text}`)
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      runRegistry.publish(run.id, 'error', { message: `Failed to spawn claude CLI: ${err.message}` })
      runRegistry.setStatus(run.id, 'failed')
      runRegistry.publish(run.id, 'done', {})
      resolveFn()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && run.status !== 'cancelled') {
        runRegistry.publish(run.id, 'error', { message: `Claude exited ${code}` })
        runRegistry.setStatus(run.id, 'failed')
        runRegistry.publish(run.id, 'done', {})
        resolveFn()
        return
      }

      // Finalize: parse the last result text and maybe advance the job status
      const { filled, skipped, blocked, suggestions } = parseAgentResult(finalText)
      const skippedLabel = skipped.length > 0 ? String(skipped.length) : ''
      const suggestionItems = suggestions.map((s, i) => ({ id: `s${i}`, ...s }))

      // Publish suggestions BEFORE done so late subscribers replay both.
      if (suggestionItems.length > 0) {
        runRegistry.setSuggestions(run.id, suggestionItems)
        runRegistry.publish(run.id, 'suggestions', { items: suggestionItems })
      }

      const suggestionHint = suggestionItems.length > 0
        ? ` ${suggestionItems.length} new answer${suggestionItems.length === 1 ? '' : 's'} to review.`
        : ''
      const shortMsg = blocked
        ? `Blocked: ${blocked}`
        : `Form filled (${filled} fields${skippedLabel ? `, ${skippedLabel} skipped` : ''}).${suggestionHint} Review in Chrome and submit when ready.`

      if (run.status !== 'cancelled' && !blocked) {
        updateJobStatus(job.id, 'ready_to_submit')
        runRegistry.setStatus(run.id, 'done', { summary: shortMsg, filled, skipped: skippedLabel, blocked, suggestionCount: suggestionItems.length })
      } else if (blocked) {
        runRegistry.setStatus(run.id, 'failed', { summary: shortMsg, blocked })
      }
      runRegistry.publish(run.id, 'done', { summary: shortMsg, suggestionCount: suggestionItems.length })
      runRegistry.prune()
      resolveFn()
    })
  })
}

function toApplyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')

    // Lever: /<company>/<id>          → /<company>/<id>/apply
    if (u.hostname.endsWith('jobs.lever.co') && !path.endsWith('/apply')) {
      u.pathname = `${path}/apply`
      return u.toString()
    }

    // Ashby: /<company>/<id>          → /<company>/<id>/application
    if (u.hostname.endsWith('jobs.ashbyhq.com') && !/\/application$/.test(path)) {
      // Only rewrite if we're at a job-detail path (3 segments: company/jobId or similar)
      const segs = path.split('/').filter(Boolean)
      if (segs.length >= 2) {
        u.pathname = `${path}/application`
        return u.toString()
      }
    }

    // Workable: /<company>/j/<id>     → /<company>/j/<id>/apply
    if (u.hostname.endsWith('workable.com') && /\/j\//.test(path) && !path.endsWith('/apply')) {
      u.pathname = `${path}/apply`
      return u.toString()
    }

    return url
  } catch {
    return url
  }
}

/**
 * Replace placeholder tokens in a mapping answer before the agent ever sees it.
 *
 * `[[company_name]]`, `[[job_title]]`, `[[job_url]]` are rendered to the job's
 * values here so the agent can use them verbatim. `[[from_cv]]` / `[[from_jd]]`
 * get a directive the skill understands — the agent writes an original answer
 * and reports it as a suggestion. Unknown tokens are left as-is.
 */
export function renderMappingAnswer(answer: string, job: Job): string {
  if (!answer) return answer
  return answer
    .replace(/\[\[company_name\]\]/g, job.company ?? '')
    .replace(/\[\[job_title\]\]/g, job.title ?? '')
    .replace(/\[\[job_url\]\]/g, job.url ?? '')
    .replace(/\[\[from_cv\]\]/g, '[agent: write an original answer grounded in the CV]')
    .replace(/\[\[from_jd\]\]/g, '[agent: write an original answer grounded in the job description]')
}

function buildAgentPrompt(
  job: Job,
  profile: ReturnType<typeof loadProfile>,
  cv: string | null,
  tabId: string,
  mappings: Array<{ question: string; answer: string }>,
  ats: Ats,
): string {
  if (!profile) return ''
  const p = profile.candidate as CandidateProfile
  const candidateJson = JSON.stringify(p, null, 2)

  const mappingsLines = mappings
    .map(m => `- "${m.question}" → "${renderMappingAnswer(m.answer, job)}"`)
    .join('\n')

  const cvBlock = cv ? cv.slice(0, 5000) : '(no CV provided)'

  const atsNotes = readSkillFile(`.claude/skills/autofiller/ats/${ats}.md`)
  const uploadsNotes = readSkillFile('.claude/skills/autofiller/uploads.md')
  const dialogsNotes = readSkillFile('.claude/skills/autofiller/dialogs.md')
  const cvPdfPath = resolveCvPdfPath(profile)

  return `/autofiller

## Job
- Title: ${job.title}
- Company: ${job.company}
- Application URL: ${job.url}

## PinchTab tab (targeted automatically)
PINCHTAB_TAB=${tabId} is already exported; every \`pinchtab\` command targets YOUR tab — do not pass --tab and do not operate on other tabs.

Bulk fill helper (for text-field batches): \`bash ${QUICKFILL_SCRIPT} '[{"ref":"e3","value":"..."}]'\`

## Candidate Profile (JSON)
\`\`\`json
${candidateJson}
\`\`\`

## Known field mappings (use first — fastest path)
${mappingsLines || '(none — fall back to profile JSON and CV for every field)'}

## CV (for open-ended answers)
${cvBlock}

## ATS-specific notes (${ats})
${atsNotes || '(no ATS-specific notes available)'}

## File upload guidance
${uploadsNotes || '(file uploads are not configured; add resume fields to skipped)'}

Resume PDF path: ${cvPdfPath ?? 'not-configured'}

## Native dialog handling
${dialogsNotes || '(no dialog handling guidance)'}`
}

export interface AgentResult {
  filled: number
  skipped: string[]
  blocked: string | null
  suggestions: Array<{ question: string; answer: string }>
}

/**
 * Parse the agent's final output. Prefers the strict JSON contract emitted by
 * the autofiller skill; falls back to the legacy `filled: N / skipped: ... /
 * blocked: ...` text format so older transcripts don't regress.
 */
export function parseAgentResult(raw: string): AgentResult {
  const text = (raw ?? '').trim()

  // Prefer a fenced ```json ... ``` block (what the skill emits).
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i)
  const jsonCandidate = fenced?.[1] ?? matchLastObject(text)

  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as {
        filled?: unknown
        skipped?: unknown
        blocked?: unknown
        suggestions?: unknown
      }
      const filled = typeof parsed.filled === 'number' ? parsed.filled : 0
      const skipped = Array.isArray(parsed.skipped)
        ? parsed.skipped.filter((s): s is string => typeof s === 'string')
        : []
      const blocked = typeof parsed.blocked === 'string' && parsed.blocked.trim()
        ? parsed.blocked.trim()
        : null
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions
            .map((s) => {
              if (!s || typeof s !== 'object') return null
              const obj = s as { question?: unknown; answer?: unknown }
              if (typeof obj.question !== 'string' || typeof obj.answer !== 'string') return null
              const q = obj.question.trim()
              const a = obj.answer.trim()
              if (!q || !a) return null
              return { question: q, answer: a }
            })
            .filter((x): x is { question: string; answer: string } => !!x)
        : []
      return { filled, skipped, blocked, suggestions }
    } catch { /* fall through to legacy parser */ }
  }

  // Legacy text-format fallback.
  let filled = 0
  let blocked: string | null = null
  const skipped: string[] = []
  const filledMatch = text.match(/filled\s*[:=]\s*(\d+)/i)
  if (filledMatch) filled = Number(filledMatch[1])
  const skippedMatch = text.match(/skipped\s*[:=]\s*([^\n]+)/i)
  if (skippedMatch) {
    const raw = skippedMatch[1].trim().replace(/^[-–—]\s*/, '')
    for (const part of raw.split(/[,;]/)) {
      const s = part.trim()
      if (s) skipped.push(s)
    }
  }
  const blockedMatch = text.match(/blocked\s*[:=]\s*([^\n]+)/i)
  if (blockedMatch) blocked = blockedMatch[1].trim()
  if (!filledMatch && !blockedMatch) {
    const fallback = text.match(/(\d+)\s*(fields?\s*filled|filled\s*fields?|fields?\s*completed)/i)
    if (fallback) filled = Number(fallback[1])
  }
  return { filled, skipped, blocked, suggestions: [] }
}

/** Find the last balanced `{...}` block in a string (naive brace-matching). */
function matchLastObject(text: string): string | null {
  const end = text.lastIndexOf('}')
  if (end < 0) return null
  let depth = 0
  for (let i = end; i >= 0; i--) {
    const ch = text[i]
    if (ch === '}') depth++
    else if (ch === '{') {
      depth--
      if (depth === 0) return text.slice(i, end + 1)
    }
  }
  return null
}
