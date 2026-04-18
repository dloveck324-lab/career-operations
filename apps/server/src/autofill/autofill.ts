import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadCv, type CandidateProfile } from '@job-pipeline/core'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { updateJobStatus, getAllFieldMappings } from '../db/queries.js'
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

  const mappings = getAllFieldMappings()
  const prompt = buildAgentPrompt(job, profile, cv, tabId, mappings)
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

function buildAgentPrompt(
  job: Job,
  profile: ReturnType<typeof loadProfile>,
  cv: string | null,
  tabId: string,
  mappings: Array<{ question: string; answer: string }>,
): string {
  if (!profile) return ''
  const p = profile.candidate as CandidateProfile
  const candidateJson = JSON.stringify(p, null, 2)

  const fieldHintsLines: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'string') fieldHintsLines.push(`- ${k.replace(/_/g, ' ')}: ${v}`)
  }

  const mappingsLines = mappings.map(m => `- "${m.question}" → "${m.answer}"`).join('\n')

  return `You are an autonomous job-application agent. Use the \`pinchtab\` CLI (already installed, authenticated, and pointing at a running *headed* Chrome instance) to open the job's application form and fill it out as completely and accurately as possible.

## PinchTab environment (do not change it)
- Headed Chrome is running on port 9868 (CLI default). A dedicated tab has been opened for this run; its ID is already exported as \`PINCHTAB_TAB=${tabId}\`, so every \`pinchtab\` command you run targets YOUR tab — do not pass \`--tab\` explicitly and do not operate on other tabs.
- DO NOT run \`pinchtab daemon ...\`, \`pinchtab tab close\`, or any instance/process kill command.
- \`navigation_changed\` errors mean the page navigated after your click — treat as success and re-snapshot.

## Job
- Title: ${job.title}
- Company: ${job.company}
- URL (your tab is already here): ${job.url}

## Sources of truth (use them IN THIS ORDER when filling any field)

### 1) Known field mappings (fastest — use first)
These are canonical question → answer pairs already curated for this candidate. If a form field's label matches (or is a close paraphrase of) any question below, use the mapped answer directly — DO NOT ask Claude for a new answer.

${mappingsLines}

### 2) Candidate profile JSON (structured fallback)
\`\`\`json
${candidateJson}
\`\`\`

Readable field list:
${fieldHintsLines.join('\n')}

### 3) CV (for open-ended answers — "why this role", "tell us about yourself", "optional note to hiring team", etc.)
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

### Bulk fill helper — USE THIS for text fields you matched against mappings or profile
\`bash ${QUICKFILL_SCRIPT} '[{"ref":"e3","value":"Vinicius"},{"ref":"#email","value":"x@y.com"}]'\`
Pass every plain text/email/URL/phone field in one call. Far fewer turns than individual \`pinchtab fill\`s.

### Location autocompletes (Ashby, Greenhouse, Lever are all similar)
Location fields usually LOOK like a text input but are actually a combobox that only commits the value once you click a suggestion from a dropdown that appears mid-typing. \`pinchtab fill\` alone won't work. The reliable pattern:
1. \`pinchtab click <ref of the location input>\` to focus it.
2. \`pinchtab type <ref> "<first few chars of the city>"\` (e.g. "San Franci") — this fires keystroke events the widget listens for. DO NOT use \`fill\` here.
3. \`pinchtab snap -i -c\` — the dropdown options now appear as new refs.
4. \`pinchtab click <ref of the matching option>\` (exact text match like "San Francisco, CA, United States").
5. Re-snap to confirm the value stuck.

If \`type\` still doesn't open the dropdown (rare but happens on fancy React inputs), fall back to \`pinchtab eval\` and dispatch an \`input\` event manually, e.g. \`pt eval "(() => { const el = document.querySelector('input[name=location]'); el.focus(); el.value='San Francisco'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"\` then re-snap and click the option.

## Your task (follow this order exactly)
1. If the current tab isn't already on the application form, navigate or click "Apply".
2. \`pinchtab snap -i -c\` to map every interactive element.
3. **Pass 1 — mapping-driven quickfill**: for every input/radio/select/checkbox whose label matches a known mapping above, collect {ref, value} pairs and fire them through the quickfill helper in ONE call. This includes work authorization, sponsorship, background check consent, "can we contact you about other roles", and all the name/email/URL/etc fields.
4. **Pass 2 — profile-driven fill**: any remaining text fields that correspond to truthy profile JSON fields (GitHub, portfolio, current_company, years_of_experience, how_did_you_hear, gender, pronouns, etc.) — fill them too. Batch with quickfill when possible.
5. **Pass 3 — radios & dropdowns for profile fields**: for radios/selects driven by profile values (gender, work auth, sponsorship, veteran/disability), click the right option. Skip when the profile value is empty.
6. **Pass 4 — open-ended questions**: write a concise, honest answer for every required open-ended text area the mappings + profile couldn't answer. This INCLUDES optional-looking fields like "Optional Note to Hiring Team", "Anything else you'd like us to know?", "Why are you interested?", cover letter paragraphs. Do NOT skip them as "optional" — a 2-4 sentence grounded note is better than a blank field and meaningfully improves recruiter signal. Ground each answer in the CV and the job posting.
7. **File uploads** — SKIP. Note them in your summary.
8. **Multi-step forms** — click Next/Continue, re-snap, repeat passes 1-6. NEVER click Submit / Send application.
9. When finished (or blocked), stop.

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
