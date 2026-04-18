import { PinchTabClient } from './pinchtab.js'
import { lookupFieldMapping, saveFieldMapping } from '../db/queries.js'
import { loadProfile, loadCv } from '@job-pipeline/core'
import { spawn } from 'child_process'
import type { Job } from '../db/schema.js'

interface AutofillResult {
  ok: boolean
  filled: number
  unfilled: number
  cached: number
  message: string
}

const INTERACTIVE_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'spinbutton', 'listbox', 'checkbox', 'radio',
])

const SUBMIT_LABELS = ['submit', 'apply', 'send application', 'submit application']
const CLAUDE_TIMEOUT_MS = 60_000

export async function startAutofill(job: Job, opts: { headless?: boolean } = {}): Promise<AutofillResult> {
  const client = new PinchTabClient()

  if (!await client.isReachable()) {
    return { ok: false, filled: 0, unfilled: 0, cached: 0, message: 'PinchTab not reachable — run: pinchtab daemon install' }
  }

  const headless = opts.headless !== false

  let instanceUrl: string
  try {
    instanceUrl = await client.ensureInstance('default', headless)
  } catch (err) {
    return { ok: false, filled: 0, unfilled: 0, cached: 0, message: `PinchTab instance start failed: ${(err as Error).message}` }
  }
  client.setInstanceUrl(instanceUrl)

  try {
    await client.navigate(job.url)
  } catch (err) {
    return { ok: false, filled: 0, unfilled: 0, cached: 0, message: `Navigation failed: ${(err as Error).message}` }
  }

  // Give dynamic forms a moment to render
  await new Promise(r => setTimeout(r, 1500))

  let snap: Awaited<ReturnType<typeof client.snap>>
  try {
    snap = await client.snap()
  } catch (err) {
    return { ok: false, filled: 0, unfilled: 0, cached: 0, message: `Snapshot failed: ${(err as Error).message}` }
  }

  const inputs = (snap.nodes ?? []).filter(n =>
    n.role && INTERACTIVE_ROLES.has(n.role.toLowerCase()) && n.name && !isSubmitButton(n.name)
  )

  const filled: Array<{ ref: string; label: string; value: string }> = []
  const missing: Array<{ ref: string; label: string }> = []
  let cachedCount = 0

  for (const el of inputs) {
    const label = (el.name ?? '').trim()
    if (!label) continue

    const cached = lookupFieldMapping(label)
    if (cached) {
      try {
        await client.fill(el.ref, cached)
        filled.push({ ref: el.ref, label, value: cached })
        cachedCount++
      } catch {
        missing.push({ ref: el.ref, label })
      }
    } else {
      missing.push({ ref: el.ref, label })
    }
  }

  // Batch Claude call for all missing fields
  if (missing.length > 0) {
    const answers = await askClaudeForFields(job, missing.map(m => m.label))
    for (const m of missing) {
      const answer = answers[m.label]
      if (answer) {
        try {
          await client.fill(m.ref, answer)
          saveFieldMapping(m.label, answer, detectAtsType(job.url))
          filled.push({ ref: m.ref, label: m.label, value: answer })
        } catch { /* skip field if fill fails */ }
      }
    }
  }

  const unfilledCount = inputs.length - filled.length
  const modeNote = headless ? 'Browser is headless — re-run with Visible to review.' : 'Review the browser window and click Submit when ready.'
  return {
    ok: true,
    filled: filled.length,
    unfilled: Math.max(0, unfilledCount),
    cached: cachedCount,
    message: `Filled ${filled.length} fields (${cachedCount} cached, ${unfilledCount} unfilled). ${modeNote}`,
  }
}

async function askClaudeForFields(job: Job, questions: string[]): Promise<Record<string, string>> {
  const profile = loadProfile()
  const cv = loadCv()
  if (!profile) return {}

  const p = profile.candidate
  const prompt = `You are filling out a job application form for:
Job: ${job.title} @ ${job.company}
Candidate: ${p.full_name} | ${p.email} | ${p.phone ?? ''} | ${p.location ?? ''}
LinkedIn: ${p.linkedin ?? ''} | GitHub: ${p.github ?? ''} | Portfolio: ${p.portfolio_url ?? ''}
${cv ? `\nCV:\n${cv.slice(0, 3000)}` : ''}

Answer each form field below with the most appropriate response. Return ONLY a JSON object mapping each question to its answer. Keep answers concise and professional.

Fields to fill:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (result: Record<string, string>) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn('claude', [
      '-p', prompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ])

    const killer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish({})
    }, CLAUDE_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', () => {
      clearTimeout(killer)
      try {
        const raw = Buffer.concat(chunks).toString()
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) { finish({}); return }
        finish(JSON.parse(jsonMatch[0]) as Record<string, string>)
      } catch { finish({}) }
    })
    child.on('error', () => { clearTimeout(killer); finish({}) })
  })
}

function isSubmitButton(label: string): boolean {
  return SUBMIT_LABELS.some(s => label.toLowerCase().includes(s))
}

function detectAtsType(url: string): string {
  if (url.includes('greenhouse.io')) return 'greenhouse'
  if (url.includes('ashbyhq.com')) return 'ashby'
  if (url.includes('jobs.lever.co')) return 'lever'
  if (url.includes('myworkdayjobs.com')) return 'workday'
  return 'custom'
}
