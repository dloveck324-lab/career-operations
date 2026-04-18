import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadCv, type CandidateProfile } from '@job-pipeline/core'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { updateJobStatus } from '../db/queries.js'
import type { Job } from '../db/schema.js'

export type AutofillModel = 'haiku' | 'sonnet' | 'opus'

interface AutofillResult {
  ok: boolean
  message: string
  model: AutofillModel
  durationMs: number
  status: 'ready_to_submit' | 'failed'
}

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

export async function startAutofill(job: Job, opts: { model?: AutofillModel } = {}): Promise<AutofillResult> {
  const model: AutofillModel = opts.model ?? 'haiku'
  const started = Date.now()
  const client = new PinchTabClient()

  console.log(`[autofill] start job=${job.id} model=${model} url=${job.url}`)

  if (!await client.isReachable()) {
    console.error('[autofill] PinchTab not reachable')
    return { ok: false, model, durationMs: 0, status: 'failed', message: 'PinchTab not reachable — run: pinchtab daemon install' }
  }

  let instanceUrl: string
  try {
    instanceUrl = await client.ensureInstance('default', false)
    console.log(`[autofill] headed Chrome ready at ${instanceUrl}`)
  } catch (err) {
    console.error('[autofill] ensureInstance failed:', err)
    return { ok: false, model, durationMs: 0, status: 'failed', message: `PinchTab instance start failed: ${(err as Error).message}` }
  }

  const profile = loadProfile()
  const cv = loadCv()
  if (!profile) {
    return { ok: false, model, durationMs: 0, status: 'failed', message: 'No candidate profile loaded (config/profile.yml)' }
  }

  const applyUrl = toApplyUrl(job.url)
  if (applyUrl !== job.url) {
    console.log(`[autofill] rewrote URL ${job.url} → ${applyUrl}`)
  }

  const prompt = buildAgentPrompt({ ...job, url: applyUrl }, profile, cv, instanceUrl)
  console.log(`[autofill] spawning claude (${MODEL_IDS[model]}), prompt=${prompt.length} chars`)

  const result = await runClaudeAgent(prompt, model)
  const durationMs = Date.now() - started

  const { filled, skipped, blocked } = parseAgentSummary(result.message)
  const shortMsg = blocked
    ? `Blocked: ${blocked}`
    : `Form filled (${filled} fields${skipped ? `, ${skipped} skipped` : ''}). Review in Chrome and submit when ready.`

  console.log(`[autofill] done ok=${result.ok && !blocked} in ${durationMs}ms — ${shortMsg}`)

  if (result.ok && !blocked) {
    updateJobStatus(job.id, 'ready_to_submit')
    return { ok: true, model, durationMs, status: 'ready_to_submit', message: shortMsg }
  }

  return { ok: false, model, durationMs, status: 'failed', message: shortMsg }
}

function toApplyUrl(url: string): string {
  // Many ATSes expose a direct form URL — skip the listing page entirely.
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    if (u.hostname.endsWith('jobs.lever.co') && !path.endsWith('/apply')) {
      u.pathname = `${path}/apply`
      return u.toString()
    }
    if (u.hostname.endsWith('greenhouse.io') && !path.endsWith('#application_form') && !path.endsWith('/apply')) {
      // Greenhouse listings already render the form inline; no rewrite needed
      return url
    }
    // Ashby: listing URL looks like /<company>/<job-id>; application form is same page with #apply anchor or inline
    return url
  } catch {
    return url
  }
}

function buildAgentPrompt(job: Job, profile: ReturnType<typeof loadProfile>, cv: string | null, instanceUrl: string): string {
  if (!profile) return ''
  const p = profile.candidate as CandidateProfile
  const candidateJson = JSON.stringify(p, null, 2)

  const fieldHintsLines: string[] = []
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'string') fieldHintsLines.push(`- ${k.replace(/_/g, ' ')}: ${v}`)
  }

  return `You are an autonomous job-application agent. Use the \`pinchtab\` CLI (already installed, authenticated, and pointing at a running *headed* Chrome instance) to open the job's application form and fill it out as completely and accurately as possible.

## PinchTab environment (do not change it)
- Headed Chrome at ${instanceUrl} (CLI default, port 9868). Plain \`pinchtab\` commands target it. DO NOT pass \`--server\` and DO NOT run \`pinchtab daemon ...\` or any instance/kill command.
- \`navigation_changed\` errors mean the page navigated after your click — treat as success and re-snapshot.

## Job
- Title: ${job.title}
- Company: ${job.company}
- URL: ${job.url}  (this is already the application form URL when possible)

## Candidate profile (JSON — every truthy field here MUST be used if the form has a matching field)
\`\`\`json
${candidateJson}
\`\`\`

Readable field list:
${fieldHintsLines.join('\n')}

## CV (for open-ended answers)
${cv ? cv.slice(0, 5000) : '(no CV provided)'}

## PinchTab CLI
- \`pinchtab nav <url>\` — navigate
- \`pinchtab snap -i -c\` — interactive elements (refs like e3 with roles and labels)
- \`pinchtab text\` — readable page text
- \`pinchtab fill <ref|css> <value>\` — text/textarea
- \`pinchtab select <ref|css> <value-or-visible-text>\` — <select> dropdowns (matches option value first, then visible text)
- \`pinchtab click <ref|css>\` — checkboxes, radios, custom dropdowns, Apply / Next buttons
- \`pinchtab press <key>\` — Tab, Enter, Escape, ArrowDown
- \`pinchtab find "<query>"\` — semantic element search
- \`pinchtab eval "<js>"\` — evaluate JS in the page (use for custom React-driven dropdowns when \`select\` doesn't work)

### Bulk fill helper — USE THIS for obvious text fields
\`bash ${QUICKFILL_SCRIPT} '[{"ref":"e3","value":"Vinicius"},{"ref":"#email","value":"x@y.com"}]'\`
Pass every plain text/email/URL/phone field you've identified in one call. It's far faster than one \`pinchtab fill\` per field.

## Your task
1. Navigate to the job URL. If it's a listing page and not the application form, click "Apply" / "Apply now" and re-snapshot.
2. Take a full \`pinchtab snap -i -c\` and map out every interactive element.
3. **Text fields** (name, email, phone, LinkedIn, GitHub, portfolio, location, current company, years of experience, "how did you hear", etc.) — batch them with the quickfill helper above. Every truthy field in the candidate profile JSON MUST be sent to its matching input if one exists.
4. **<select> dropdowns** — use \`pinchtab select <ref> "<visible text>"\`. If that fails (React-controlled widgets), click the ref to open it, re-snap, click the option text.
5. **Radio buttons** (gender, work authorization, require sponsorship, veteran/disability status) — match the candidate's value from the profile. \`pinchtab click <ref of the chosen option>\`. If the candidate field is empty, skip that group (don't guess).
6. **Checkboxes** — only check them if required (usually a consent / "I agree" box). Do NOT auto-check the diversity/demographic self-id boxes unless the candidate profile has the value.
7. **File uploads** (resume, cover letter, transcript) — SKIP. Note them in your summary.
8. **Open-ended text** ("Why this company", "Tell us about yourself", "What draws you to this role") — write a concise, honest 2-4 sentence answer grounded in the CV and job description.
9. **Multi-step forms** — click Next/Continue, re-snap, continue filling. NEVER click Submit / Send application.
10. When finished (or blocked), stop.

## Output (CRITICAL — keep short)
Respond with at most 3 short lines, nothing else. Format:
\`filled: N\`
\`skipped: <comma-separated field names>\` (omit line if none)
\`blocked: <one-line reason>\` (omit line if not blocked)

Do NOT include a verbose summary, field-by-field breakdown, markdown headers, or status commentary.`
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
  // Fallback — if no structured markers, try to count from free text
  if (!filledMatch && !blockedMatch) {
    const fallback = text.match(/(\d+)\s*(fields?\s*filled|filled\s*fields?|fields?\s*completed)/i)
    if (fallback) filled = Number(fallback[1])
  }
  const skippedCount = skipped ? skipped.split(/[,;]/).filter(Boolean).length : 0
  return { filled, skipped: skippedCount > 0 ? String(skippedCount) : '', blocked }
}

async function runClaudeAgent(prompt: string, model: AutofillModel): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const args = [
      '-p', prompt,
      '--model', MODEL_IDS[model],
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
    ]
    const child = spawn('claude', args, { env: { ...process.env } })
    console.log(`[autofill] claude pid=${child.pid}`)

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      if (!settled) {
        settled = true
        resolve({ ok: false, message: `Claude agent timed out after ${CLAUDE_TIMEOUT_MS[model] / 1000}s` })
      }
    }, CLAUDE_TIMEOUT_MS[model])

    let buf = ''
    let finalText = ''
    child.stdout.on('data', (c: Buffer) => {
      stdoutChunks.push(c)
      buf += c.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line) as { type?: string; message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> }; subtype?: string; result?: string }
          if (ev.type === 'system' && ev.subtype === 'init') {
            console.log(`[autofill] claude session started`)
          } else if (ev.type === 'assistant' && ev.message?.content) {
            for (const c of ev.message.content) {
              if (c.type === 'text' && c.text?.trim()) {
                const snippet = c.text.trim().slice(0, 200).replace(/\s+/g, ' ')
                console.log(`[autofill] thinking: ${snippet}${c.text.length > 200 ? '…' : ''}`)
                finalText += c.text
              }
              if (c.type === 'tool_use') {
                const input = c.input ?? {}
                let hint = ''
                if (typeof input.command === 'string') hint = ` → ${input.command.slice(0, 140)}`
                else if (typeof input.url === 'string') hint = ` → ${input.url}`
                console.log(`[autofill] tool: ${c.name}${hint}`)
              }
            }
          } else if (ev.type === 'result' && ev.result) {
            finalText = ev.result
          }
        } catch { /* non-JSON line */ }
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      stderrChunks.push(c)
      console.error(`[autofill stderr] ${c.toString().trim().slice(0, 400)}`)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      resolve({ ok: false, message: `Failed to spawn claude CLI: ${err.message}` })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      const stdoutText = Buffer.concat(stdoutChunks).toString()
      const stderr = Buffer.concat(stderrChunks).toString().trim()
      if (code !== 0) {
        resolve({ ok: false, message: `Claude exited ${code}: ${stderr.slice(0, 400) || stdoutText.slice(0, 400)}` })
        return
      }
      const summary = finalText.trim() || '(no output)'
      resolve({ ok: true, message: summary.slice(0, 2000) })
    })
  })
}
