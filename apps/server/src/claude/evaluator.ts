import { spawn } from 'child_process'
import { loadProfile, loadProfileVariant, loadCv, type ProfileVariant } from '@job-pipeline/core'
import type { Job, ProfileVariantDb, EvalErrorKind } from '../db/schema.js'
import { getRecentLessons } from '../db/queries.js'

/**
 * Map a free-form Claude CLI error message to a structured kind so the UI
 * can surface the right signal. Patterns intentionally match broadly —
 * a false positive on `'credits'` is acceptable (banner appears, user
 * verifies and dismisses); a false negative is worse (user is left guessing).
 */
export function classifyEvalError(message: string): EvalErrorKind {
  const m = (message ?? '').toLowerCase()
  if (/credit|balance|insufficient.*quota|402|payment.required/.test(m)) return 'credits'
  if (/rate.?limit|429|too.many.requests/.test(m)) return 'rate_limit'
  if (/no json|parse|unexpected token/.test(m)) return 'parse'
  if (/401|unauthor|invalid.*api.?key|authentication/.test(m)) return 'auth'
  return 'other'
}

export interface ParsedEvalResponse {
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
  /** Raw arrays from the eval JSON — stored for per-line feedback in the UI. */
  green_flags: string[]
  red_flags: string[]
}

export interface EvalResult extends ParsedEvalResponse {
  profile_variant: ProfileVariantDb
  /** Populated only for ambiguous jobs in Tier 2/3 — the loser of the dual eval. */
  dual_secondary?: EvalResult
}

export interface EvaluateOptions {
  /** Force a specific profile variant. Defaults to job.industry_vertical → 'generic' fallback. */
  variant?: ProfileVariant
  /** Tier 2 = quick (Haiku). Tier 3 = deep (Sonnet). */
  depth?: 'quick' | 'deep'
  modelOverride?: string
  signal?: AbortSignal
}

const MAX_DESC_CHARS = 8000  // ~2000 tokens. Comp/benefits sections often
                              // appear deep in JDs (after responsibilities,
                              // perks, EEO). 3000 chars was cutting them off.
const MAX_CV_CHARS = 3500    // up from 2000 — full headline + recent role bullets

/**
 * Pull a compensation snippet out of the raw JD before truncation, so the
 * evaluator sees it even when it sits at char 12,000. Hits explicit ranges
 * ("$195,000 - $225,000") and shorthand ("$200K base"). Returns null for
 * vague "competitive"/"DOE" mentions — those add noise without signal.
 */
export function extractCompSnippet(description: string): string | null {
  if (!description) return null
  // Look for an explicit dollar-amount range or a single $XK figure with
  // a money-context lead-in. We capture the full sentence/line as context
  // so the evaluator can interpret (annual? equity? base? OTE?).
  const patterns: RegExp[] = [
    // "$195,000 - $225,000" or "$195K - $225K", optionally with USD/annual
    /[^\n.]{0,80}\$\s?\d{2,3}[,\d]*[kK]?\s*[-–to]+\s*\$?\s?\d{2,3}[,\d]*[kK]?[^\n.]{0,80}/g,
    // "$200K base" / "$200K salary" / "base pay: $200K"
    /[^\n.]{0,40}(?:base|salary|compensation|target|OTE|pay)[^\n.]{0,40}\$\s?\d{2,3}[,\d]*[kK]?[^\n.]{0,40}/gi,
    // "compensation: $195,000 to $225,000"
    /(?:compensation|salary|pay)\s*(?:range)?\s*(?:is|:|of)?[^\n.]{0,160}/gi,
  ]
  for (const re of patterns) {
    const matches = description.match(re)
    if (!matches) continue
    for (const m of matches) {
      // Reject if it's only the lead-in word with no dollar sign — that
      // catches "competitive compensation" and "compensation TBD".
      if (/\$\s?\d/.test(m)) {
        return m.trim().replace(/\s+/g, ' ').slice(0, 200)
      }
    }
  }
  return null
}

/**
 * Tier 2/3 evaluator (Step 4 of docs/DUAL_PROFILE_MIGRATION.md).
 *
 * - Picks profile variant from job.industry_vertical unless explicitly overridden.
 * - For ambiguous jobs: runs healthcare + generic in parallel and returns the
 *   higher-scoring one as primary, with the loser attached as dual_secondary.
 *
 * Backward compat: legacy positional signature (job, description, deep, modelOverride, signal)
 * still works — callers were updated in Step 4.
 */
export async function evaluateJob(
  job: Job,
  description: string,
  options: EvaluateOptions = {},
): Promise<EvalResult> {
  const target = options.variant ?? resolveVariantFromJob(job)

  if (target === 'ambiguous') {
    const [hc, generic] = await Promise.all([
      evaluateJobInternal(job, description, 'healthcare', options),
      evaluateJobInternal(job, description, 'generic', options),
    ])
    const [primary, secondary] = hc.score >= generic.score ? [hc, generic] : [generic, hc]
    return { ...primary, dual_secondary: secondary }
  }

  return evaluateJobInternal(job, description, target, options)
}

function resolveVariantFromJob(job: Job): ProfileVariant | 'ambiguous' {
  const v = job.industry_vertical
  if (v === 'healthcare' || v === 'generic' || v === 'ambiguous') return v
  return 'generic'  // 'unclassified' or undefined → generic (safe default)
}

async function evaluateJobInternal(
  job: Job,
  description: string,
  variant: ProfileVariant,
  options: EvaluateOptions,
): Promise<EvalResult> {
  const profile = loadProfileVariant(variant) ?? loadProfile()
  const cv = loadCv(variant)
  const deep = options.depth === 'deep'
  const model = options.modelOverride ?? (deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001')

  const lessons = loadLessonsBlock(15)
  const prompt = buildSkillPrompt(profile, cv, job, description, lessons)
  const raw = await runClaudeCli(prompt, model, options.signal)
  const parsed = parseEvalResponse(raw, model)
  return { ...parsed, profile_variant: variant }
}

/**
 * Pull recent user-corrected feedback rows and format them as a prompt block.
 * Returns an empty string if no actionable lessons exist — the block is then
 * omitted entirely from the prompt to keep small evals lean.
 */
export function loadLessonsBlock(limit = 15): string {
  let lessons: Array<{ flag_text: string; correction: string; flag_type: string }> = []
  try {
    lessons = getRecentLessons(limit)
  } catch {
    // DB error reading lessons must NEVER block an eval — degrade silently.
    return ''
  }
  if (lessons.length === 0) return ''
  const lines = lessons.map(l => `- When tempted to flag "${l.flag_text}" — user noted: ${l.correction}`)
  return `LESSONS FROM PRIOR FEEDBACK (apply these before flagging — if a past lesson conflicts with your read of this JD, scan the JD again before committing to the flag):
${lines.join('\n')}`
}

function buildSkillPrompt(
  profile: ReturnType<typeof loadProfile>,
  cv: string | null,
  job: Job,
  description: string,
  lessons = '',
): string {
  const desc = description.length > MAX_DESC_CHARS
    ? description.slice(0, MAX_DESC_CHARS) + '\n[truncated]'
    : description

  // Scan the FULL description for comp before truncation. Guarantees the
  // model sees comp even when it sits past MAX_DESC_CHARS.
  const compFromDesc = extractCompSnippet(description)

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

  const cvBlock = cv ? `\n\nCV (first ${MAX_CV_CHARS} chars):\n${cv.slice(0, MAX_CV_CHARS)}` : ''

  const compLine = job.comp_text
    ? `COMP: ${job.comp_text}`
    : compFromDesc
      ? `COMP: Not in structured field — extracted from JD body: "${compFromDesc}"`
      : 'COMP: Not listed'

  const jobBlock = `JOB: ${job.title} @ ${job.company}
LOCATION: ${job.location ?? 'Not specified'} | ${job.remote_policy ?? 'unknown'}
${compLine}
URL: ${job.url}

DESCRIPTION:
${desc}`

  const lessonsBlock = lessons ? `\n\n${lessons}` : ''

  return `/job-evaluator

${candidateBlock}${cvBlock}${lessonsBlock}

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

export function parseEvalResponse(raw: string, model: string): ParsedEvalResponse {
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
    green_flags: parsed.green_flags ?? [],
    red_flags: parsed.red_flags ?? [],
  }
}
