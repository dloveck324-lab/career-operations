import { PinchTabClient } from './pinchtab.js'
import { loadProfile, loadCv } from '@job-pipeline/core'
import { spawn } from 'child_process'
import type { Job } from '../db/schema.js'

export type AutofillModel = 'haiku' | 'sonnet' | 'opus'

interface AutofillResult {
  ok: boolean
  message: string
  model: AutofillModel
  durationMs: number
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

export async function startAutofill(job: Job, opts: { model?: AutofillModel } = {}): Promise<AutofillResult> {
  const model: AutofillModel = opts.model ?? 'haiku'
  const started = Date.now()
  const client = new PinchTabClient()

  console.log(`[autofill] start job=${job.id} model=${model} url=${job.url}`)

  if (!await client.isReachable()) {
    console.error('[autofill] PinchTab not reachable')
    return { ok: false, model, durationMs: 0, message: 'PinchTab not reachable — run: pinchtab daemon install' }
  }

  try {
    const url = await client.ensureInstance('default', false)
    console.log(`[autofill] headed Chrome ready at ${url}`)
  } catch (err) {
    console.error('[autofill] ensureInstance failed:', err)
    return { ok: false, model, durationMs: 0, message: `PinchTab instance start failed: ${(err as Error).message}` }
  }

  const profile = loadProfile()
  const cv = loadCv()
  if (!profile) {
    console.error('[autofill] no profile loaded')
    return { ok: false, model, durationMs: 0, message: 'No candidate profile loaded (config/profile.yml)' }
  }

  const prompt = buildAgentPrompt(job, profile, cv)
  console.log(`[autofill] spawning claude (${MODEL_IDS[model]}), prompt=${prompt.length} chars`)

  const result = await runClaudeAgent(prompt, model)
  const durationMs = Date.now() - started
  console.log(`[autofill] done ok=${result.ok} in ${durationMs}ms — ${result.message.slice(0, 200)}`)
  return { ok: result.ok, model, durationMs, message: result.message }
}

function buildAgentPrompt(job: Job, profile: ReturnType<typeof loadProfile>, cv: string | null): string {
  if (!profile) return ''
  const p = profile.candidate
  return `You are an autonomous job-application agent. Use the \`pinchtab\` CLI (already installed, authenticated, and pointing at a running headed Chrome instance) to open the job page below and fill out its application form as completely and accurately as possible.

## Job
- Title: ${job.title}
- Company: ${job.company}
- URL: ${job.url}

## Candidate profile
- Full name: ${p.full_name}
- Email: ${p.email}
- Phone: ${p.phone ?? ''}
- Location: ${p.location ?? ''}
- LinkedIn: ${p.linkedin ?? ''}
- GitHub: ${p.github ?? ''}
- Portfolio: ${p.portfolio_url ?? ''}
${(p as { work_authorization?: string }).work_authorization ? `- Work authorization: ${(p as { work_authorization?: string }).work_authorization}` : ''}

## CV (for open-ended questions like "why this role", experience summaries, etc.)
${cv ? cv.slice(0, 5000) : '(no CV provided)'}

## PinchTab CLI reference (use bash to run these)
- \`pinchtab nav <url>\` — navigate the current tab
- \`pinchtab snap -i -c\` — get interactive elements with refs like e3, e7, plus their roles/labels
- \`pinchtab snap --text\` — page text
- \`pinchtab text\` — readable page text
- \`pinchtab fill <ref|css> <value>\` — set an input/textarea value
- \`pinchtab select <ref|css> <value>\` — pick a dropdown option (value or visible text)
- \`pinchtab click <ref|css>\` — click an element (use for checkboxes, radios, "Apply" button to open the form, expanding sections)
- \`pinchtab press <key>\` — e.g. Tab, Enter, Escape
- \`pinchtab find "<query>"\` — semantic search for an element (returns refs)

## Your task
1. Navigate to the job URL.
2. If the page is the listing (not the application form), locate and click the "Apply" / "Apply now" button to open the form. Many ATS pages (Greenhouse, Ashby, Lever) host the form inline — re-snapshot after clicking.
3. Re-snapshot the page. Fill every required field using the candidate profile and CV. For long-form questions ("Why this company?", "Tell us about yourself"), write a concise, honest 2-4 sentence answer grounded in the CV.
4. Handle multi-step forms: after filling the visible fields, click Next/Continue, re-snapshot, and continue. Do NOT click Submit / Send application — stop when you reach it.
5. If uploads (resume, cover letter) are requested, skip them — the user will handle uploads manually. Note which uploads are still needed in your summary.
6. If you get stuck (captcha, login wall, unrecognized field), stop and report what's blocking.

## Output
After you finish (or get blocked), respond with a brief summary (<= 8 lines) covering:
- Fields filled successfully
- Fields skipped and why (upload, captcha, ambiguous, etc.)
- Whether the form is ready for the user to review and submit
Do not include the full prompt or verbose tool output.`
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
                if (typeof input.command === 'string') hint = ` → ${input.command.slice(0, 120)}`
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
