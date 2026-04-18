import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadCv, type CandidateProfile } from '@job-pipeline/core'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { updateJobStatus } from '../db/queries.js'
import { runRegistry, type Run } from './runs.js'
import type { Job } from '../db/schema.js'

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
    runRegistry.publish(run.id, 'status', { stage: 'tab_opened', tabId, url: applyUrl })
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

  const prompt = buildAgentPrompt(job, profile, cv, tabId)
  runRegistry.publish(run.id, 'prompt', { text: prompt, model: MODEL_IDS[run.model] })

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
      const { filled, skipped, blocked } = parseAgentSummary(finalText)
      const shortMsg = blocked
        ? `Blocked: ${blocked}`
        : `Form filled (${filled} fields${skipped ? `, ${skipped} skipped` : ''}). Review in Chrome and submit when ready.`

      if (run.status !== 'cancelled' && !blocked) {
        updateJobStatus(job.id, 'ready_to_submit')
        runRegistry.setStatus(run.id, 'done', { summary: shortMsg, filled, skipped, blocked })
      } else if (blocked) {
        runRegistry.setStatus(run.id, 'failed', { summary: shortMsg, blocked })
      }
      runRegistry.publish(run.id, 'done', { summary: shortMsg })
      runRegistry.prune()
      resolveFn()
    })
  })
}

function toApplyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    if (u.hostname.endsWith('jobs.lever.co') && !path.endsWith('/apply')) {
      u.pathname = `${path}/apply`
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}

function buildAgentPrompt(job: Job, profile: ReturnType<typeof loadProfile>, cv: string | null, tabId: string): string {
  if (!profile) return ''
  const p = profile.candidate as CandidateProfile
  const candidateJson = JSON.stringify(p, null, 2)

  const fieldHintsLines: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'string') fieldHintsLines.push(`- ${k.replace(/_/g, ' ')}: ${v}`)
  }

  return `You are an autonomous job-application agent. Use the \`pinchtab\` CLI (already installed, authenticated, and pointing at a running *headed* Chrome instance) to open the job's application form and fill it out as completely and accurately as possible.

## PinchTab environment (do not change it)
- Headed Chrome is running on port 9868 (CLI default). A dedicated tab has been opened for this run; its ID is already exported as \`PINCHTAB_TAB=${tabId}\`, so every \`pinchtab\` command you run targets YOUR tab — do not pass \`--tab\` explicitly and do not operate on other tabs.
- DO NOT run \`pinchtab daemon ...\`, \`pinchtab tab close\`, or any instance/process kill command.
- \`navigation_changed\` errors mean the page navigated after your click — treat as success and re-snapshot.

## Job
- Title: ${job.title}
- Company: ${job.company}
- URL (your tab is already here): ${job.url}

## Candidate profile (JSON — every truthy field MUST be used if a matching form field exists)
\`\`\`json
${candidateJson}
\`\`\`

Readable field list:
${fieldHintsLines.join('\n')}

## CV (for open-ended answers)
${cv ? cv.slice(0, 5000) : '(no CV provided)'}

## PinchTab CLI
- \`pinchtab snap -i -c\` — interactive elements (refs like e3 with roles and labels)
- \`pinchtab text\` — readable page text
- \`pinchtab fill <ref|css> <value>\` — text/textarea
- \`pinchtab select <ref|css> <value-or-visible-text>\` — <select> dropdowns (matches option value first, then visible text)
- \`pinchtab click <ref|css>\` — checkboxes, radios, custom dropdowns, Apply / Next buttons
- \`pinchtab press <key>\` — Tab, Enter, Escape, ArrowDown
- \`pinchtab find "<query>"\` — semantic element search
- \`pinchtab eval "<js>"\` — JS in the page (use for custom React dropdowns when \`select\` doesn't work)

### Bulk fill helper — USE THIS for obvious text fields
\`bash ${QUICKFILL_SCRIPT} '[{"ref":"e3","value":"Vinicius"},{"ref":"#email","value":"x@y.com"}]'\`
Pass every plain text/email/URL/phone field in one call. Far fewer turns than individual \`pinchtab fill\`s.

## Your task
1. If the current tab isn't already on the application form (empty page, listing page, login wall), navigate or click "Apply".
2. \`pinchtab snap -i -c\` to map every interactive element.
3. **Text fields** (name, email, phone, LinkedIn, GitHub, portfolio, location, current company, years, how-did-you-hear) — batch via quickfill. Every truthy profile field MUST be sent to its matching input.
4. **<select> dropdowns** — \`pinchtab select <ref> "<visible text>"\`. If that fails, click the ref, re-snap, click the option.
5. **Radios** (gender, work authorization, sponsorship, veteran/disability) — match the candidate's value. \`pinchtab click <ref of chosen option>\`. Empty candidate field → skip.
6. **Checkboxes** — only required consent boxes. Don't auto-check demographic self-id unless the candidate profile has a value.
7. **File uploads** — SKIP. Note them in your summary.
8. **Open-ended text** — 2-4 honest sentences grounded in the CV and job description.
9. **Multi-step forms** — click Next/Continue, re-snap, continue. NEVER click Submit / Send application.
10. When finished (or blocked), stop.

## Output (CRITICAL — short)
Respond with at most 3 lines, nothing else:
\`filled: N\`
\`skipped: <comma-separated field names>\` (omit if none)
\`blocked: <one-line reason>\` (omit if not blocked)`
}

function parseAgentSummary(raw: string): { filled: number; skipped: string; blocked: string } {
  const text = raw.trim()
  let filled = 0
  let skipped = ''
  let blocked = ''
  const filledMatch = text.match(/filled\s*[:=]\s*(\d+)/i)
  if (filledMatch) filled = Number(filledMatch[1])
  const skippedMatch = text.match(/skipped\s*[:=]\s*([^\n]+)/i)
  if (skippedMatch) skipped = skippedMatch[1].trim().replace(/^[-–—]\s*/, '')
  const blockedMatch = text.match(/blocked\s*[:=]\s*([^\n]+)/i)
  if (blockedMatch) blocked = blockedMatch[1].trim()
  if (!filledMatch && !blockedMatch) {
    const fallback = text.match(/(\d+)\s*(fields?\s*filled|filled\s*fields?|fields?\s*completed)/i)
    if (fallback) filled = Number(fallback[1])
  }
  const skippedCount = skipped ? skipped.split(/[,;]/).filter(Boolean).length : 0
  return { filled, skipped: skippedCount > 0 ? String(skippedCount) : '', blocked }
}
