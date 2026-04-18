import { db, type Job, type JobStatus } from './schema.js'
export type { JobStatus }
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
                      comp_text, description_hash, status, archetype, skip_reason)
    VALUES (@source, @external_id, @url, @company, @title, @location, @remote_policy,
            @comp_text, @description_hash, @status, @archetype, @skip_reason)
  `).run(job)

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

export function getJobStats(): Record<JobStatus, number> {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  `).all() as Array<{ status: JobStatus; count: number }>

  const stats: Record<string, number> = {}
  for (const row of rows) stats[row.status] = row.count
  return stats as Record<JobStatus, number>
}

// ── Field Mappings ────────────────────────────────────────────────────────────

export function lookupFieldMapping(questionText: string): string | null {
  const hash = hashText(questionText.toLowerCase().trim())
  const row = db.prepare('SELECT answer FROM field_mappings WHERE question_hash = ?').get(hash) as { answer: string } | null
  if (row) {
    db.prepare("UPDATE field_mappings SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE question_hash = ?").run(hash)
    return row.answer
  }
  return null
}

export function saveFieldMapping(questionText: string, answer: string, atsType?: string) {
  const hash = hashText(questionText.toLowerCase().trim())
  db.prepare(`
    INSERT INTO field_mappings (question_hash, question_text, answer, ats_type)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(question_hash) DO UPDATE SET
      answer = excluded.answer,
      ats_type = excluded.ats_type,
      last_used_at = datetime('now'),
      use_count = use_count + 1
  `).run(hash, questionText, answer, atsType ?? null)
}

export function getFieldMappings() {
  return db.prepare('SELECT * FROM field_mappings ORDER BY use_count DESC').all()
}

export function saveFieldMappingIfMissing(questionText: string, answer: string, atsType?: string): boolean {
  if (!answer) return false
  const hash = hashText(questionText.toLowerCase().trim())
  const result = db.prepare(`
    INSERT OR IGNORE INTO field_mappings (question_hash, question_text, answer, ats_type)
    VALUES (?, ?, ?, ?)
  `).run(hash, questionText, answer, atsType ?? null)
  return result.changes > 0
}

export function seedFieldMappingsFromProfile(profile: ProfileConfig): number {
  const p = profile.candidate
  const nameParts = p.full_name.trim().split(/\s+/)
  const firstName = nameParts[0] ?? ''
  const lastName = nameParts.slice(1).join(' ')

  const mappings: Array<[string, string]> = [
    ['Full Name', p.full_name],
    ['Name', p.full_name],
    ['Your Name', p.full_name],
    ['Applicant Name', p.full_name],
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
      ['City, State', p.location] as [string, string],
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
  ]

  let seeded = 0
  for (const [question, answer] of mappings) {
    if (saveFieldMappingIfMissing(question, answer, 'profile')) seeded++
  }
  return seeded
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

export function bulkUpdateStatus(ids: number[], status: JobStatus): number {
  if (ids.length === 0) return 0
  const run = db.transaction((list: number[]) => {
    let changes = 0
    const stmt = db.prepare(`UPDATE jobs SET status = @status, updated_at = datetime('now') WHERE id = @id`)
    for (const id of list) {
      const r = stmt.run({ status, id }) as { changes: number }
      changes += r.changes
    }
    return changes
  })
  return run(ids)
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
}) {
  db.prepare(`
    INSERT INTO evaluations (job_id, model, prompt_tokens, completion_tokens, score, verdict_md, raw_response)
    VALUES (@job_id, @model, @prompt_tokens, @completion_tokens, @score, @verdict_md, @raw_response)
  `).run(data)
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
