import { db, type Job, type JobStatus, type EvalErrorKind } from './schema.js'
export type { JobStatus, EvalErrorKind }
import { createHash } from 'crypto'
import type { ProfileConfig } from '@job-pipeline/core'

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export function upsertJob(job: Omit<Job, 'id' | 'scraped_at' | 'updated_at'>): { inserted: boolean; id: number } {
  const existing = db.prepare('SELECT id FROM jobs WHERE source = ? AND external_id = ?')
    .get(job.source, job.external_id) as { id: number } | undefined

  if (existing) return { inserted: false, id: existing.id }

  const result = db.prepare(`
    INSERT INTO jobs (source, external_id, url, company, title, location, remote_policy,
                      comp_text, description_hash, status, archetype, skip_reason,
                      industry_vertical, directional_score)
    VALUES (@source, @external_id, @url, @company, @title, @location, @remote_policy,
            @comp_text, @description_hash, @status, @archetype, @skip_reason,
            COALESCE(@industry_vertical, 'unclassified'), @directional_score)
  `).run({
    ...job,
    industry_vertical: job.industry_vertical ?? null,
    directional_score: job.directional_score ?? null,
  })

  return { inserted: true, id: result.lastInsertRowid as number }
}

export function upsertJobContent(jobId: number, rawText: string, cleanedMd: string) {
  db.prepare(`
    INSERT INTO jobs_content (job_id, raw_text, cleaned_md)
    VALUES (?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET raw_text = excluded.raw_text, cleaned_md = excluded.cleaned_md
  `).run(jobId, rawText, cleanedMd)
}

export function getJobContent(jobId: number): { raw_text: string; cleaned_md: string } | null {
  return db.prepare('SELECT raw_text, cleaned_md FROM jobs_content WHERE job_id = ?')
    .get(jobId) as { raw_text: string; cleaned_md: string } | null
}

export function getJobs(status?: JobStatus | JobStatus[]): Job[] {
  if (!status) return db.prepare('SELECT * FROM jobs ORDER BY score DESC, scraped_at DESC').all() as Job[]
  const statuses = Array.isArray(status) ? status : [status]
  const placeholders = statuses.map(() => '?').join(',')
  return db.prepare(`SELECT * FROM jobs WHERE status IN (${placeholders}) ORDER BY score DESC, scraped_at DESC`)
    .all(...statuses) as Job[]
}

export function getPrescreenedCompanies(): string[] {
  return (db.prepare("SELECT DISTINCT company FROM jobs WHERE status = 'prescreened' ORDER BY company")
    .all() as { company: string }[]).map(r => r.company)
}

export function getJob(id: number): Job | null {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | null
}

export function updateJobStatus(id: number, status: JobStatus, extra?: Partial<Pick<Job, 'score' | 'score_reason' | 'archetype' | 'skip_reason' | 'evaluated_at' | 'applied_at'>>) {
  const updates = ['status = @status', "updated_at = datetime('now')"]
  const params: Record<string, unknown> = { id, status }

  if (extra?.score !== undefined) { updates.push('score = @score'); params.score = extra.score }
  if (extra?.score_reason) { updates.push('score_reason = @score_reason'); params.score_reason = extra.score_reason }
  if (extra?.archetype) { updates.push('archetype = @archetype'); params.archetype = extra.archetype }
  if (extra?.skip_reason) { updates.push('skip_reason = @skip_reason'); params.skip_reason = extra.skip_reason }
  if (extra?.evaluated_at) { updates.push('evaluated_at = @evaluated_at'); params.evaluated_at = extra.evaluated_at }
  if (extra?.applied_at) { updates.push('applied_at = @applied_at'); params.applied_at = extra.applied_at }

  db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = @id`).run(params)
}

// ── Eval failure tracking ────────────────────────────────────────────────────
//
// The evaluator can fail for many reasons: API credit exhaustion, rate
// limits, malformed Claude output, or server errors. Without persistence
// the same broken jobs get retried on every EVALUATE click, and the user
// has no signal as to why.
//
// `recordEvalFailure` increments a counter; after MAX_EVAL_ATTEMPTS the
// job is auto-skipped with a structured `skip_reason`. Credit-related
// errors are exempt from auto-skip — the user fixes the credits and
// retries; we don't want a billing outage to bury 76 jobs.
//
// `commitEvaluation` is the success path — it wraps saveEvaluation +
// status update + counter reset in a single SQLite transaction so an
// abort signal between the calls can't leave the job in a half-state.

export const MAX_EVAL_ATTEMPTS = 3

interface RecordEvalFailureResult {
  attempts: number
  skipped: boolean
}

/**
 * Increment the failure counter on a job. If the new attempt count is
 * `>= MAX_EVAL_ATTEMPTS` AND the kind is not 'credits' (which is treated
 * as transient infra), the job is moved to 'skipped' with a structured
 * skip_reason.
 */
export function recordEvalFailure(
  id: number,
  errorMessage: string,
  options?: { kind?: EvalErrorKind },
): RecordEvalFailureResult {
  const truncated = errorMessage.slice(0, 500)
  const kind = options?.kind ?? 'other'
  const row = db.prepare(`
    UPDATE jobs
    SET eval_attempts = eval_attempts + 1,
        eval_last_error = @err,
        eval_last_error_kind = @kind,
        eval_last_attempted_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = @id
    RETURNING eval_attempts
  `).get({ id, err: truncated, kind }) as { eval_attempts: number } | undefined
  const attempts = row?.eval_attempts ?? 0
  // Credit-shaped errors are NEVER auto-skipped: the user needs to top
  // up; the jobs should remain retriable. Same for rate_limit and auth
  // (transient or fixable).
  const isInfra = kind === 'credits' || kind === 'rate_limit' || kind === 'auth'
  if (attempts >= MAX_EVAL_ATTEMPTS && !isInfra) {
    updateJobStatus(id, 'skipped', { skip_reason: `eval_failed: ${truncated.slice(0, 200)}` })
    return { attempts, skipped: true }
  }
  return { attempts, skipped: false }
}

/** Reset the failure counter. Called inside `commitEvaluation` on success. */
export function clearEvalFailure(id: number): void {
  db.prepare(`
    UPDATE jobs
    SET eval_attempts = 0,
        eval_last_error = NULL,
        eval_last_error_kind = NULL,
        eval_last_attempted_at = NULL
    WHERE id = ?
  `).run(id)
}

/**
 * Atomic save+update for the success path. Wrapping these three writes
 * in a single transaction prevents the orphan-row race where an abort
 * signal between saveEvaluation and updateJobStatus would leave the job
 * still flagged 'prescreened' despite having a stored evaluation.
 */
export function commitEvaluation(args: {
  evaluation: Parameters<typeof saveEvaluation>[0]
  secondary?: Parameters<typeof saveEvaluation>[0]
  jobId: number
  statusUpdate: Partial<Pick<Job, 'score' | 'score_reason' | 'archetype' | 'evaluated_at'>> & { status: JobStatus }
}): void {
  const tx = db.transaction(() => {
    saveEvaluation(args.evaluation)
    if (args.secondary) saveEvaluation(args.secondary)
    db.prepare(`
      UPDATE jobs
      SET eval_attempts = 0,
          eval_last_error = NULL,
          eval_last_error_kind = NULL,
          eval_last_attempted_at = NULL
      WHERE id = ?
    `).run(args.jobId)
    const { status, ...extra } = args.statusUpdate
    updateJobStatus(args.jobId, status, extra)
  })
  tx()
}

export function getJobStats(): Record<JobStatus, number> {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  `).all() as Array<{ status: JobStatus; count: number }>

  const stats: Record<string, number> = {}
  for (const row of rows) stats[row.status] = row.count
  return stats as Record<JobStatus, number>
}

// ── Field Mappings ────────────────────────────────────────────────────────────
//
// Field mappings are partitioned by profile_variant (Partition A — Step 5 of
// docs/DUAL_PROFILE_MIGRATION.md). Same question can have different answers
// per variant; each variant has its own row. Default variant is 'generic' so
// legacy callers keep working when they don't specify one.

type FmVariant = 'healthcare' | 'generic'

export function lookupFieldMapping(questionText: string, variant: FmVariant = 'generic'): string | null {
  const hash = hashText(questionText.toLowerCase().trim())
  const row = db
    .prepare('SELECT answer FROM field_mappings WHERE question_hash = ? AND profile_variant = ?')
    .get(hash, variant) as { answer: string } | null
  if (row) {
    db.prepare(
      "UPDATE field_mappings SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE question_hash = ? AND profile_variant = ?",
    ).run(hash, variant)
    return row.answer
  }
  return null
}

export function saveFieldMapping(
  questionText: string,
  answer: string,
  variant: FmVariant = 'generic',
  atsType?: string,
) {
  const hash = hashText(questionText.toLowerCase().trim())
  db.prepare(`
    INSERT INTO field_mappings (question_hash, question_text, answer, ats_type, profile_variant)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(question_hash, profile_variant) DO UPDATE SET
      answer = excluded.answer,
      ats_type = excluded.ats_type,
      last_used_at = datetime('now'),
      use_count = use_count + 1
  `).run(hash, questionText, answer, atsType ?? null, variant)
}

export function getFieldMappings() {
  return db.prepare('SELECT * FROM field_mappings ORDER BY use_count DESC').all()
}

export function saveFieldMappingIfMissing(
  questionText: string,
  answer: string,
  variant: FmVariant = 'generic',
  atsType?: string,
): boolean {
  if (!answer) return false
  const hash = hashText(questionText.toLowerCase().trim())
  const result = db.prepare(`
    INSERT OR IGNORE INTO field_mappings (question_hash, question_text, answer, ats_type, profile_variant)
    VALUES (?, ?, ?, ?, ?)
  `).run(hash, questionText, answer, atsType ?? null, variant)
  return result.changes > 0
}

export function seedFieldMappingsFromProfile(profile: ProfileConfig, variant?: FmVariant): number {
  if (!variant) {
    // No variant specified → seed both partitions from the same top-level
    // candidate fields. Per Partition A, identical answers are duplicated
    // across variants by design.
    return seedFieldMappingsFromProfile(profile, 'generic')
      + seedFieldMappingsFromProfile(profile, 'healthcare')
  }
  return seedFieldMappingsFromProfileVariant(profile, variant)
}

function seedFieldMappingsFromProfileVariant(profile: ProfileConfig, variant: FmVariant): number {
  const p = profile.candidate as ProfileConfig['candidate'] & {
    gender?: string
    pronouns?: string
    race_ethnicity?: string
    veteran_status?: string
    disability_status?: string
    work_authorization?: string
    requires_sponsorship?: string
    current_company?: string
    years_of_experience?: string
    how_did_you_hear?: string
  }
  // Defensive: a partial candidate block (e.g. mid-onboarding before the
  // resume step has run) must not crash boot. Default missing strings to '';
  // mappings just won't seed for empty answers.
  const fullName = (p.full_name ?? '').trim()
  const nameParts = fullName.split(/\s+/)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  // Normalize common yes/no shapes so the answer matches whatever the form expects.
  const workAuth = p.work_authorization ?? 'Yes'
  const needsSponsorship = p.requires_sponsorship ?? 'No'

  const mappings: Array<[string, string]> = [
    ['Full Name', fullName],
    ['Name', fullName],
    ['Your Name', fullName],
    ['Applicant Name', fullName],
    ['First Name', firstName],
    ['Last Name', lastName],
    ['Email', p.email],
    ['Email Address', p.email],
    ['Your Email', p.email],
    ...(p.phone ? [
      ['Phone', p.phone] as [string, string],
      ['Phone Number', p.phone] as [string, string],
      ['Mobile Number', p.phone] as [string, string],
      ['Mobile Phone', p.phone] as [string, string],
    ] : []),
    ...(p.location ? [
      ['Location', p.location] as [string, string],
      ['Current Location', p.location] as [string, string],
      ['City, State', p.location] as [string, string],
      ['Current City', p.location] as [string, string],
    ] : []),
    ...(p.linkedin ? [
      ['LinkedIn', p.linkedin] as [string, string],
      ['LinkedIn URL', p.linkedin] as [string, string],
      ['LinkedIn Profile', p.linkedin] as [string, string],
      ['LinkedIn Profile URL', p.linkedin] as [string, string],
    ] : []),
    ...(p.portfolio_url ? [
      ['Portfolio', p.portfolio_url] as [string, string],
      ['Portfolio URL', p.portfolio_url] as [string, string],
      ['Website', p.portfolio_url] as [string, string],
      ['Personal Website', p.portfolio_url] as [string, string],
    ] : []),
    ...(p.github ? [
      ['GitHub', p.github] as [string, string],
      ['GitHub URL', p.github] as [string, string],
      ['GitHub Profile', p.github] as [string, string],
    ] : []),
    // ── Screening / legal ──────────────────────────────────────────────────
    ['Are you legally authorized to work in the country where this job is based?', workAuth],
    ['Are you legally authorized to work full-time in the country where this job is based?', workAuth],
    ['Are you authorized to work in the United States?', workAuth],
    ['Work Authorization', workAuth],
    ['Will you now or in the future require employer sponsorship for employment authorization in the country where this job is based?', needsSponsorship],
    ['Will you now or in the future require sponsorship for employment visa status?', needsSponsorship],
    ['Do you require visa sponsorship?', needsSponsorship],
    ['Visa Sponsorship Required', needsSponsorship],
    // Consent / marketing
    ['Background Check Consent', 'Yes'],
    ['I consent to a background check', 'Yes'],
    ['Do you agree to a background check?', 'Yes'],
    ['Do you agree to allow us to contact you about job opportunities?', 'Yes'],
    ['May we contact you about other relevant opportunities?', 'Yes'],
    ['Would you like to be considered for other roles?', 'Yes'],
    ['I agree to the terms and conditions', 'Yes'],
    ['I acknowledge the privacy policy', 'Yes'],
    // Demographics (only if candidate filled them)
    ...(p.gender ? [
      ['Gender', p.gender] as [string, string],
      ['Gender Identity', p.gender] as [string, string],
      ['What is your gender?', p.gender] as [string, string],
    ] : []),
    ...(p.pronouns ? [
      ['Pronouns', p.pronouns] as [string, string],
      ['Preferred Pronouns', p.pronouns] as [string, string],
      ['What are your pronouns?', p.pronouns] as [string, string],
    ] : []),
    ...(p.race_ethnicity ? [
      ['Race', p.race_ethnicity] as [string, string],
      ['Ethnicity', p.race_ethnicity] as [string, string],
      ['Race/Ethnicity', p.race_ethnicity] as [string, string],
      ['What is your race/ethnicity?', p.race_ethnicity] as [string, string],
    ] : []),
    ...(p.veteran_status ? [
      ['Veteran Status', p.veteran_status] as [string, string],
      ['Are you a protected veteran?', p.veteran_status] as [string, string],
    ] : []),
    ...(p.disability_status ? [
      ['Disability Status', p.disability_status] as [string, string],
      ['Do you have a disability?', p.disability_status] as [string, string],
    ] : []),
    // Employment context
    ...(p.current_company ? [
      ['Current Company', p.current_company] as [string, string],
      ['Current Employer', p.current_company] as [string, string],
      ['Where do you currently work?', p.current_company] as [string, string],
    ] : []),
    ...(p.years_of_experience ? [
      ['Years of Experience', p.years_of_experience] as [string, string],
      ['Total Years of Experience', p.years_of_experience] as [string, string],
      ['How many years of experience do you have?', p.years_of_experience] as [string, string],
    ] : []),
    ...(p.how_did_you_hear ? [
      ['How did you hear about us?', p.how_did_you_hear] as [string, string],
      ['How did you hear about this role?', p.how_did_you_hear] as [string, string],
      ['Referral Source', p.how_did_you_hear] as [string, string],
    ] : []),
  ]

  let seeded = 0
  for (const [question, answer] of mappings) {
    if (saveFieldMappingIfMissing(question, answer, variant, 'profile')) seeded++
  }
  return seeded
}

/**
 * Return stored mappings as a flat list — useful for injecting into agent prompts.
 * Filters by variant when provided so autofill only sees the active profile's answers.
 * Variant omitted = legacy mode (returns all rows; only meaningful while a single
 * variant is in use).
 */
export function getAllFieldMappings(variant?: FmVariant): Array<{ question: string; answer: string }> {
  const rows = variant
    ? db
        .prepare('SELECT question_text AS question, answer FROM field_mappings WHERE profile_variant = ? ORDER BY use_count DESC')
        .all(variant)
    : db.prepare('SELECT question_text AS question, answer FROM field_mappings ORDER BY use_count DESC').all()
  return rows as Array<{ question: string; answer: string }>
}

// ── Scan Runs ─────────────────────────────────────────────────────────────────

export function startScanRun(): number {
  const result = db.prepare('INSERT INTO scan_runs DEFAULT VALUES').run()
  return result.lastInsertRowid as number
}

export function updateScanRun(id: number, data: Partial<{ found: number; added: number; skipped: number; cost_tokens: number; ended_at: string; status: string }>) {
  const updates = Object.keys(data).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE scan_runs SET ${updates} WHERE id = @id`).run({ id, ...data })
}

export function getJobsForReprescreen(): Array<{ id: number; title: string; location: string | null; company: string; comp_text: string | null; description: string | null }> {
  return db.prepare(`
    SELECT j.id, j.title, j.location, j.company, j.comp_text, jc.cleaned_md as description
    FROM jobs j
    LEFT JOIN jobs_content jc ON jc.job_id = j.id
    WHERE j.status = 'prescreened'
  `).all() as Array<{ id: number; title: string; location: string | null; company: string; comp_text: string | null; description: string | null }>
}

export function getJobsForLinkCheck(olderThanDays = 3, limit = 300): Array<{ id: number; url: string; company: string; title: string }> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
  return db.prepare(`
    SELECT id, url, company, title FROM jobs
    WHERE status IN ('prescreened', 'evaluated') AND scraped_at < ?
    ORDER BY scraped_at ASC LIMIT ?
  `).all(cutoff, limit) as Array<{ id: number; url: string; company: string; title: string }>
}

export function getJobsByIds(ids: number[]): Job[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  return db.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders})`).all(ids) as Job[]
}

export function getLastScanRun() {
  return db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get()
}

// ── Re-queue ──────────────────────────────────────────────────────────────────

export function requeueJobs(ids?: number[]): number {
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    const result = db.prepare(`
      UPDATE jobs
      SET status = 'prescreened', score = NULL, score_reason = NULL,
          archetype = NULL, evaluated_at = NULL, updated_at = datetime('now')
      WHERE id IN (${placeholders}) AND status = 'evaluated'
    `).run(ids) as { changes: number }
    return result.changes
  }
  const result = db.prepare(`
    UPDATE jobs
    SET status = 'prescreened', score = NULL, score_reason = NULL,
        archetype = NULL, evaluated_at = NULL, updated_at = datetime('now')
    WHERE status = 'evaluated'
  `).run() as { changes: number }
  return result.changes
}

export function bulkUpdateStatus(ids: number[], status: JobStatus, skipReason?: string): number {
  if (ids.length === 0) return 0
  const run = db.transaction((list: number[]) => {
    let changes = 0
    const stmt = skipReason
      ? db.prepare(`UPDATE jobs SET status = @status, skip_reason = @skip_reason, updated_at = datetime('now') WHERE id = @id`)
      : db.prepare(`UPDATE jobs SET status = @status, updated_at = datetime('now') WHERE id = @id`)
    for (const id of list) {
      const r = stmt.run(skipReason ? { status, skip_reason: skipReason, id } : { status, id }) as { changes: number }
      changes += r.changes
    }
    return changes
  })
  return run(ids)
}

// ── Skip tagging ──────────────────────────────────────────────────────────────
//
// When the user manually skips a job with a reason, Haiku classifies it into
// a structured tag. These tags accumulate and are aggregated by `getSkipPatterns`
// to surface recurring reasons and suggest prescreen blocklist additions.

export interface SkipPattern {
  category: string
  count: number
  keywords: string[]
  examples: Array<{ id: number; company: string; title: string; skip_reason: string | null }>
}

export function setSkipTags(id: number, tags: { category: string; keywords: string[] }): void {
  db.prepare(`UPDATE jobs SET skip_tags = ? WHERE id = ?`).run(JSON.stringify(tags), id)
}

export function getSkipPatterns(): SkipPattern[] {
  const rows = db.prepare(`
    SELECT id, company, title, skip_reason, skip_tags
    FROM jobs
    WHERE status = 'skipped' AND skip_tags IS NOT NULL
    ORDER BY updated_at DESC
  `).all() as Array<{ id: number; company: string; title: string; skip_reason: string | null; skip_tags: string }>

  // Aggregate by category
  const byCategory = new Map<string, { count: number; keywords: Set<string>; examples: SkipPattern['examples'] }>()

  for (const row of rows) {
    let parsed: { category?: string; keywords?: string[] }
    try { parsed = JSON.parse(row.skip_tags) } catch { continue }

    const category = typeof parsed.category === 'string' ? parsed.category : 'other'
    const keywords: string[] = Array.isArray(parsed.keywords) ? parsed.keywords.filter(k => typeof k === 'string') : []

    if (!byCategory.has(category)) {
      byCategory.set(category, { count: 0, keywords: new Set(), examples: [] })
    }
    const entry = byCategory.get(category)!
    entry.count++
    for (const kw of keywords) entry.keywords.add(kw)
    if (entry.examples.length < 3) {
      entry.examples.push({ id: row.id, company: row.company, title: row.title, skip_reason: row.skip_reason })
    }
  }

  return [...byCategory.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([category, v]) => ({
      category,
      count: v.count,
      keywords: [...v.keywords],
      examples: v.examples,
    }))
}

// ── Evaluations ───────────────────────────────────────────────────────────────

export function saveEvaluation(data: {
  job_id: number
  model: string
  prompt_tokens?: number
  completion_tokens?: number
  score: number
  verdict_md?: string
  raw_response?: string
  profile_variant?: 'healthcare' | 'generic'
}) {
  db.prepare(`
    INSERT INTO evaluations
      (job_id, model, prompt_tokens, completion_tokens, score, verdict_md, raw_response, profile_variant)
    VALUES
      (@job_id, @model, @prompt_tokens, @completion_tokens, @score, @verdict_md, @raw_response,
       COALESCE(@profile_variant, 'generic'))
  `).run({ ...data, profile_variant: data.profile_variant ?? null })
}

export function getTokenUsage(since: 'day' | 'week' | 'month' = 'day'): { prompt: number; completion: number; total: number } {
  const intervals: Record<string, string> = {
    day: "datetime('now', '-1 day')",
    week: "datetime('now', '-7 days')",
    month: "datetime('now', '-30 days')",
  }
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(prompt_tokens), 0) as prompt,
      COALESCE(SUM(completion_tokens), 0) as completion,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total
    FROM evaluations
    WHERE created_at > ${intervals[since]}
  `).get() as { prompt: number; completion: number; total: number }
  return row
}
