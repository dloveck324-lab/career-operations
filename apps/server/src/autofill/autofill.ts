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

const SUBMIT_LABELS = ['submit', 'apply', 'send application', 'submit application']

export async function startAutofill(job: Job, opts: { headless?: boolean } = {}): Promise<AutofillResult> {
  const client = new PinchTabClient()

  if (!await client.isReachable()) {
    return { ok: false, filled: 0, unfilled: 0, cached: 0, message: 'PinchTab not reachable — run: pinchtab daemon install' }
  }

  const mode = opts.headless !== false ? 'headless' : 'headed'
  await client.startInstance(mode)
  await client.navigate(job.url)

  const snap = await client.snap()
  const inputs = snap.elements.filter(el => ['input', 'textarea', 'select'].includes(el.tag.toLowerCase()))

  const filled: Array<{ ref: string; label: string; value: string }> = []
  const missing: Array<{ ref: string; label: string }> = []
  let cachedCount = 0

  for (const el of inputs) {
    const label = el.label ?? el.placeholder ?? el.ref
    if (!label || isSubmitButton(label)) continue

    const cached = lookupFieldMapping(label)
    if (cached) {
      await client.fill(el.ref, cached)
      filled.push({ ref: el.ref, label, value: cached })
      cachedCount++
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
        await client.fill(m.ref, answer)
        saveFieldMapping(m.label, answer, detectAtsType(job.url))
        filled.push({ ref: m.ref, label: m.label, value: answer })
      }
    }
  }

  // In headless mode: show browser to let user review before submitting
  if (mode === 'headless') {
    await client.showBrowser()
  }

  const unfilled = missing.length - (filled.length - cachedCount)
  return {
    ok: true,
    filled: filled.length,
    unfilled: Math.max(0, unfilled),
    cached: cachedCount,
    message: `Filled ${filled.length} fields (${cachedCount} cached). Review form and click Submit when ready.`,
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
    const child = spawn('claude', [
      '-p', prompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ])

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', () => {
      try {
        const raw = Buffer.concat(chunks).toString()
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) { resolve({}); return }
        resolve(JSON.parse(jsonMatch[0]) as Record<string, string>)
      } catch { resolve({}) }
    })
    child.on('error', () => resolve({}))
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
