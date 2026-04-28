import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadProfileVariant, loadCv, type CandidateProfile } from '@job-pipeline/core'
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
 * Resolve a concrete profile variant for a job in the autofill flow.
 * Healthcare stays healthcare; everything else (generic, ambiguous,
 * unclassified, undefined) falls back to generic. For ambiguous jobs we
 * log a warning so it's discoverable until Step 7 surfaces a UI picker.
 */
export function resolveVariantForJob(job: Job): 'healthcare' | 'generic' {
  if (job.industry_vertical === 'healthcare') return 'healthcare'
  if (job.industry_vertical === 'ambiguous') {
    console.warn(`[autofill] job ${job.id} is ambiguous — defaulting to 'generic' variant. ` +
      `(Step 7 will add a UI picker for this case.)`)
  }
  return 'generic'
}

/**
 * Kick off an autofill run. Returns immediately with the runId; the caller
 * should subscribe to /apply/runs/:runId/events to watch progress.
 *
 * The variant is locked at run-create time and sticks for the full session
 * (pause/resume, save-mappings) — see Step 6 of docs/DUAL_PROFILE_MIGRATION.md.
 * If `variant` isn't passed, we resolve from job.industry_vertical: healthcare
 * stays healthcare; everything else (generic, ambiguous, unclassified) maps
 * to generic. Step 7 will surface a UI picker for ambiguous jobs and pass
 * the explicit variant through.
 */
export async function startAutofill(
  job: Job,
  opts: { model?: AutofillModel; variant?: 'healthcare' | 'generic' } = {},
): Promise<{ runId: string }> {
  const model: AutofillModel = opts.model ?? 'haiku'
  const variant: 'healthcare' | 'generic' = opts.variant ?? resolveVariantForJob(job)
  const run = runRegistry.create(job.id, model, variant)

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

  // Flip to 'running' the moment real work starts. 'queued' should only mean
  // "waiting in the bulk concurrency queue" — not "pinchtab/nav in progress".
  runRegistry.setStatus(run.id, 'running')
  // Emit model info immediately so the UI can show the chip before any
  // infra step (PinchTab, Claude) has a chance to fail.
  runRegistry.publish(run.id, 'status', { stage: 'starting', model: MODEL_IDS[run.model] })

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

  // Get the active tab ID from snapshot (read-only — never creates a new Chrome target).
  // Then navigate via JS eval instead of /navigate (which always calls Target.createTarget
  // and fails with "context deadline exceeded" on this machine).
  const applyUrl = toApplyUrl(job.url)
  let tabId: string
  try {
    console.log(`[autofill] run=${run.id} step=getActiveTabId`)
    const activeTabId = await client.getActiveTabId()
    console.log(`[autofill] run=${run.id} step=getActiveTabId result=${activeTabId ?? '(null)'}`)
    tabId = activeTabId ?? 'default'
    runRegistry.setTabId(run.id, tabId)

    runRegistry.publish(run.id, 'status', { stage: 'navigating', tabId, url: applyUrl })
    console.log(`[autofill] run=${run.id} step=navigateViaEval url=${applyUrl}`)
    await client.navigateViaEval(applyUrl, tabId === 'default' ? undefined : tabId)
    console.log(`[autofill] run=${run.id} step=navigateViaEval done`)

    const targetHost = new URL(applyUrl).hostname
    console.log(`[autofill] run=${run.id} step=waitForUrl host=${targetHost}`)
    runRegistry.publish(run.id, 'status', { stage: 'waiting_for_page', url: applyUrl })
    let loadedUrl = await client.waitForUrl(targetHost, 20_000)
    console.log(`[autofill] run=${run.id} step=waitForUrl result=${loadedUrl || '(timeout)'}`)

    if (!loadedUrl) {
      runRegistry.publish(run.id, 'status', { stage: 'nav_retry', url: applyUrl })
      console.log(`[autofill] run=${run.id} step=nav_retry`)
      await client.navigateViaEval(applyUrl, tabId === 'default' ? undefined : tabId)
      loadedUrl = await client.waitForUrl(targetHost, 15_000)
      console.log(`[autofill] run=${run.id} step=nav_retry result=${loadedUrl || '(timeout)'}`)
    }
    if (!loadedUrl) {
      throw new Error(`Page did not load after eval navigation to ${applyUrl} — is Chrome open and the PinchTab daemon running?`)
    }
    runRegistry.publish(run.id, 'status', { stage: 'tab_ready', tabId, url: loadedUrl })
    console.log(`[autofill] run=${run.id} step=tab_ready url=${loadedUrl}`)
  } catch (err) {
    runRegistry.publish(run.id, 'error', { message: `Failed to navigate to application: ${(err as Error).message}` })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  const variant = run.variant
  const profile = loadProfileVariant(variant) ?? loadProfile()
  const cv = loadCv(variant)
  if (!profile) {
    runRegistry.publish(run.id, 'error', { message: 'No candidate profile loaded (config/profile.yml)' })
    runRegistry.setStatus(run.id, 'failed')
    return
  }

  const mappings = getAllFieldMappings(variant)
  runRegistry.publish(run.id, 'status', { stage: 'profile_variant_resolved', variant })
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

    // Inactivity timeout: resets on every stdout chunk so long-running but
    // active fills don't get killed. Only fires when Claude goes silent.
    let timedOut = false
    let timer = setTimeout(fireTimeout, CLAUDE_TIMEOUT_MS[run.model])
    function fireTimeout() {
      timedOut = true
      runRegistry.publish(run.id, 'error', { message: `Claude agent timed out after ${CLAUDE_TIMEOUT_MS[run.model] / 1000}s of inactivity` })
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }

    let buf = ''
    let finalText = ''
    let finalized = false
    const finalizeOnce = () => {
      if (finalized) return
      finalized = true
      clearTimeout(timer)
      finalizeRun(run, job, finalText)
      // NOTE: we intentionally keep the CLI process alive (stdin stays open)
      // so the user can keep chatting with the same session via live stdin.
      // The run is marked 'done' so the UI drops the loading state.
    }
    child.stdout.on('data', (c: Buffer) => {
      // Reset inactivity timer on every chunk of output
      clearTimeout(timer)
      timer = setTimeout(fireTimeout, CLAUDE_TIMEOUT_MS[run.model])

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
            // The 'result' event is terminal for this turn; with stream-json
            // input the CLI would otherwise sit idle waiting for more stdin
            // until the inactivity timer kills it. Finalize immediately.
            finalizeOnce()
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

      // Cancelled: cancel() already published done — nothing more to do.
      if (run.status === 'cancelled') { resolveFn(); return }

      // Already finalized on the 'result' event — nothing more to do.
      if (finalized) { resolveFn(); return }

      // Timeout with partial result: Claude finished its work but the process
      // didn't exit before the inactivity window. Treat as success.
      if (timedOut) {
        finalizeOnce()
        resolveFn()
        return
      }

      // Real non-zero exit (not a signal kill)
      if (code !== 0) {
        runRegistry.publish(run.id, 'error', { message: `Claude exited with code ${code}` })
        runRegistry.setStatus(run.id, 'failed')
        runRegistry.publish(run.id, 'done', {})
        resolveFn()
        return
      }

      finalizeOnce()
      resolveFn()
    })
  })
}

function finalizeRun(run: Run, job: Job, finalText: string): void {
  const { filled, skipped, blocked, suggestions } = parseAgentResult(finalText)
  const skippedLabel = skipped.length > 0 ? String(skipped.length) : ''
  const suggestionItems = suggestions.map((s, i) => ({ id: `s${i}`, ...s }))

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

  if (!blocked) {
    updateJobStatus(job.id, 'ready_to_submit')
    runRegistry.setStatus(run.id, 'done', { summary: shortMsg, filled, skipped: skippedLabel, blocked, suggestionCount: suggestionItems.length })
  } else {
    runRegistry.setStatus(run.id, 'failed', { summary: shortMsg, blocked })
  }
  runRegistry.publish(run.id, 'done', { summary: shortMsg, suggestionCount: suggestionItems.length })
  runRegistry.prune()
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
