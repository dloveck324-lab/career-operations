import { spawn } from 'child_process'
import { loadProfile, loadCv } from '@job-pipeline/core'
import type { Job } from '../db/schema.js'

export interface EvalResult {
  model: string
  score: number          // 1–5 global score (career-ops scale)
  archetype: string | null
  cv_match: number | null
  north_star: number | null
  comp: number | null
  cultural_signals: number | null
  verdict_md: string
  prompt_tokens: number
  completion_tokens: number
  raw_response: string
}

const MAX_DESC_CHARS = 3000  // ~750 tokens

export async function evaluateJob(job: Job, description: string, deep = false, modelOverride?: string, signal?: AbortSignal): Promise<EvalResult> {
  const profile = loadProfile()
  const cv = loadCv()
  const model = modelOverride ?? (deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001')

  const prompt = buildSkillPrompt(profile, cv, job, description)

  const raw = await runClaudeCli(prompt, model, signal)
  return parseEvalResponse(raw, model)
}

function buildSkillPrompt(
  profile: ReturnType<typeof loadProfile>,
  cv: string | null,
  job: Job,
  description: string,
): string {
  const desc = description.length > MAX_DESC_CHARS
    ? description.slice(0, MAX_DESC_CHARS) + '\n[truncated]'
    : description

  const candidateBlock = profile
    ? (() => {
        const p = profile.candidate
        const archetypes = profile.target_roles.archetypes.map(a => `${a.name} (${a.fit})`).join(', ')
        const superpowers = profile.narrative.superpowers?.join(', ') ?? ''
        return `CANDIDATE: ${p.full_name} — ${profile.narrative.headline}
TARGET ARCHETYPES: ${archetypes}
SUPERPOWERS: ${superpowers}
TARGET COMP: ${profile.compensation.target_range} (min ${profile.compensation.minimum})
LOCATION: ${profile.location.city}, ${profile.location.country} | ${profile.compensation.location_flexibility ?? 'remote preferred'}
VISA: ${profile.location.visa_status ?? 'N/A'}`
      })()
    : 'CANDIDATE: (profile not configured)'

  const cvBlock = cv ? `\n\nCV (first 2000 chars):\n${cv.slice(0, 2000)}` : ''

  const jobBlock = `JOB: ${job.title} @ ${job.company}
LOCATION: ${job.location ?? 'Not specified'} | ${job.remote_policy ?? 'unknown'}
COMP: ${job.comp_text ?? 'Not listed'}
URL: ${job.url}

DESCRIPTION:
${desc}`

  return `/job-evaluator

${candidateBlock}${cvBlock}

---

${jobBlock}`
}

async function runClaudeCli(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('AbortError')); return }

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    const child = spawn('claude', [
      '-p', prompt,
      '--model', model,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ], { env: { ...process.env } })

    const onAbort = () => { child.kill('SIGKILL'); reject(new Error('AbortError')) }
    signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString()
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      resolve(Buffer.concat(chunks).toString())
    })

    child.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err) })
  })
}

export function parseEvalResponse(raw: string, model: string): EvalResult {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON found in response: ${raw.slice(0, 200)}`)

  const parsed = JSON.parse(jsonMatch[0]) as {
    score?: number
    archetype?: string | null
    cv_match?: number | null
    north_star?: number | null
    comp?: number | null
    cultural_signals?: number | null
    verdict?: string
    red_flags?: string[]
    green_flags?: string[]
  }

  const clamp15 = (n: number | null | undefined) =>
    typeof n === 'number' ? Math.max(1, Math.min(5, n)) : null

  const score = clamp15(parsed.score) ?? 1
  const cv_match = clamp15(parsed.cv_match)
  const north_star = clamp15(parsed.north_star)
  const comp = clamp15(parsed.comp)
  const cultural_signals = clamp15(parsed.cultural_signals)

  const dimLine = [
    cv_match != null ? `Experience ${cv_match.toFixed(1)}` : null,
    north_star != null ? `Role Fit ${north_star.toFixed(1)}` : null,
    comp != null ? `Comp ${comp.toFixed(1)}` : null,
    cultural_signals != null ? `Culture ${cultural_signals.toFixed(1)}` : null,
  ].filter(Boolean).join(' · ')

  const prosSection = (parsed.green_flags ?? []).length > 0
    ? `Pros\n${(parsed.green_flags ?? []).map(f => `• ${f}`).join('\n')}`
    : null

  const consSection = (parsed.red_flags ?? []).length > 0
    ? `Cons\n${(parsed.red_flags ?? []).map(f => `• ${f}`).join('\n')}`
    : null

  const verdict_md = [
    dimLine,
    parsed.verdict ?? '',
    prosSection,
    consSection,
  ].filter(Boolean).join('\n\n').trim()

  return {
    model,
    score,
    archetype: parsed.archetype ?? null,
    cv_match,
    north_star,
    comp,
    cultural_signals,
    verdict_md,
    prompt_tokens: 0,
    completion_tokens: 0,
    raw_response: raw.slice(0, 2000),
  }
}
