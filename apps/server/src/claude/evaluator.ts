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

const ARCHETYPES = `
ARCHETYPE DETECTION — classify the job into one of these slugs:
  llmops          → "observability", "evals", "pipelines", "monitoring", "reliability"
  agentic         → "agent", "HITL", "orchestration", "workflow", "multi-agent"
  ai-pm           → "PRD", "roadmap", "discovery", "stakeholder", "product manager"
  solutions-arch  → "architecture", "enterprise", "integration", "design", "systems"
  forward-deployed→ "client-facing", "deploy", "prototype", "fast delivery", "field"
  transformation  → "change management", "adoption", "enablement", "transformation"
If hybrid, pick the dominant one.`

const SCORING_RUBRIC = `
SCORING (1–5 scale, one decimal each):
  cv_match        — skills, experience, proof points vs JD requirements
  north_star      — fit with candidate's target archetypes and career direction
  comp            — salary vs market (5=top quartile, 3=unknown/unclear, 1=well below); use comp_text if present
  cultural_signals— remote policy, growth signals, stability, culture fit
  score (global)  — weighted average: cv_match×0.35 + north_star×0.30 + comp×0.20 + cultural_signals×0.15, then subtract up to 1.0 for hard blockers (visa required, onsite-only mismatch, etc.)

THRESHOLDS:
  ≥4.5 → Strong match — apply immediately
  4.0–4.4 → Good match — worth applying
  3.5–3.9 → Marginal — apply only if specific reason
  <3.5 → Recommend against`

export async function evaluateJob(job: Job, description: string, deep = false, modelOverride?: string): Promise<EvalResult> {
  const profile = loadProfile()
  const cv = loadCv()
  const model = modelOverride ?? (deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001')

  const systemPrompt = buildSystemPrompt(profile, cv)
  const userPrompt = buildUserPrompt(job, description)

  const fullPrompt = `<system>\n${systemPrompt}\n</system>\n\n<user>\n${userPrompt}\n</user>`

  const raw = await runClaudeCli(fullPrompt, model)
  return parseEvalResponse(raw, model)
}

function buildSystemPrompt(profile: ReturnType<typeof loadProfile>, cv: string | null): string {
  if (!profile) return 'You are a job-fit evaluator. Return JSON only.'

  const p = profile.candidate
  const archetypes = profile.target_roles.archetypes.map(a => `${a.name} (${a.fit})`).join(', ')
  const superpowers = profile.narrative.superpowers?.join(', ') ?? ''
  const cvSection = cv ? `\n\nCV (first 2000 chars):\n${cv.slice(0, 2000)}` : ''

  return `You are a precise job-fit evaluator. Return ONLY valid JSON, no markdown fences.

CANDIDATE: ${p.full_name} — ${profile.narrative.headline}
TARGET ARCHETYPES: ${archetypes}
SUPERPOWERS: ${superpowers}
TARGET COMP: ${profile.compensation.target_range} (min ${profile.compensation.minimum})
LOCATION: ${profile.location.city}, ${profile.location.country} | ${profile.compensation.location_flexibility ?? 'remote preferred'}
VISA: ${profile.location.visa_status ?? 'N/A'}${cvSection}
${ARCHETYPES}
${SCORING_RUBRIC}

OUTPUT SCHEMA (JSON, no extra fields):
{
  "score": <number 1-5, one decimal>,
  "archetype": <archetype slug from list above>,
  "cv_match": <number 1-5>,
  "north_star": <number 1-5>,
  "comp": <number 1-5 or null if truly no data>,
  "cultural_signals": <number 1-5>,
  "verdict": <2-3 sentence fit summary — direct and specific, no corporate-speak>,
  "red_flags": [<string>, ...],
  "green_flags": [<string>, ...]
}`
}

function buildUserPrompt(job: Job, description: string): string {
  const desc = description.length > MAX_DESC_CHARS
    ? description.slice(0, MAX_DESC_CHARS) + '\n[truncated]'
    : description

  return `JOB: ${job.title} @ ${job.company}
LOCATION: ${job.location ?? 'Not specified'} | ${job.remote_policy ?? 'unknown'}
COMP: ${job.comp_text ?? 'Not listed'}
URL: ${job.url}

DESCRIPTION:
${desc}`
}

async function runClaudeCli(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    const child = spawn('claude', [
      '-p', prompt,
      '--model', model,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ], { env: { ...process.env } })

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    child.on('close', code => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString()
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      resolve(Buffer.concat(chunks).toString())
    })

    child.on('error', reject)
  })
}

function parseEvalResponse(raw: string, model: string): EvalResult {
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
    cv_match != null ? `CV ${cv_match.toFixed(1)}` : null,
    north_star != null ? `NS ${north_star.toFixed(1)}` : null,
    comp != null ? `Comp ${comp.toFixed(1)}` : null,
    cultural_signals != null ? `Culture ${cultural_signals.toFixed(1)}` : null,
  ].filter(Boolean).join(' · ')

  const flags = [
    ...(parsed.red_flags ?? []).map(f => `⚠ ${f}`),
    ...(parsed.green_flags ?? []).map(f => `✓ ${f}`),
  ]

  const verdict_md = [
    dimLine,
    parsed.verdict ?? '',
    flags.join('\n'),
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
