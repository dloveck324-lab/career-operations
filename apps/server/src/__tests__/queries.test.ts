import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../db/schema.js', () => import('./helpers/testDb.js'))

import { db } from './helpers/testDb.js'
import {
  hashText,
  upsertJob,
  getJobs,
  getJob,
  updateJobStatus,
  lookupFieldMapping,
  saveFieldMapping,
  saveFieldMappingIfMissing,
  upsertJobContent,
  getJobContent,
  recordEvalFailure,
  clearEvalFailure,
  commitEvaluation,
  MAX_EVAL_ATTEMPTS,
} from '../db/queries.js'
import type { JobStatus } from '../db/queries.js'

const BASE_JOB = {
  source: 'greenhouse',
  url: 'https://example.com/job/1',
  company: 'Acme',
  title: 'Senior Engineer',
  location: 'Remote',
  remote_policy: 'remote',
  comp_text: '$150k',
  description_hash: null,
  status: 'prescreened' as JobStatus,
  archetype: null,
  score: null,
  score_reason: null,
  skip_reason: null,
  evaluated_at: null,
  applied_at: null,
}

let idSeq = 0
const nextJob = (overrides: Partial<typeof BASE_JOB> = {}) => ({
  ...BASE_JOB,
  external_id: `test-${++idSeq}`,
  ...overrides,
})

beforeEach(() => {
  db.exec('DELETE FROM jobs; DELETE FROM field_mappings; DELETE FROM scan_runs;')
})

// ── hashText ──────────────────────────────────────────────────────────────────

describe('hashText', () => {
  it('returns a 16-char hex string', () => {
    expect(hashText('hello')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic', () => {
    expect(hashText('same input')).toBe(hashText('same input'))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashText('hello')).not.toBe(hashText('world'))
  })
})

// ── upsertJob ─────────────────────────────────────────────────────────────────

describe('upsertJob', () => {
  it('inserts a new job and returns inserted=true with a positive id', () => {
    const result = upsertJob(nextJob())
    expect(result.inserted).toBe(true)
    expect(result.id).toBeGreaterThan(0)
  })

  it('returns inserted=false and the original id for duplicate source+external_id', () => {
    const job = nextJob()
    const first = upsertJob(job)
    const second = upsertJob({ ...job, title: 'Different Title' })
    expect(second.inserted).toBe(false)
    expect(second.id).toBe(first.id)
  })

  it('inserted job is retrievable via getJob', () => {
    const { id } = upsertJob(nextJob({ title: 'Test Job', company: 'TestCo' }))
    const job = getJob(id)
    expect(job?.title).toBe('Test Job')
    expect(job?.company).toBe('TestCo')
  })
})

// ── getJobs ───────────────────────────────────────────────────────────────────

describe('getJobs', () => {
  it('returns all jobs when called with no filter', () => {
    upsertJob(nextJob({ status: 'prescreened' }))
    upsertJob(nextJob({ status: 'evaluated' }))
    expect(getJobs().length).toBeGreaterThanOrEqual(2)
  })

  it('filters by single status', () => {
    upsertJob(nextJob({ status: 'prescreened' }))
    upsertJob(nextJob({ status: 'evaluated' }))
    const prescreened = getJobs('prescreened')
    expect(prescreened.every(j => j.status === 'prescreened')).toBe(true)
  })

  it('filters by multiple statuses', () => {
    upsertJob(nextJob({ status: 'prescreened' }))
    upsertJob(nextJob({ status: 'evaluated' }))
    upsertJob(nextJob({ status: 'skipped' }))
    const results = getJobs(['prescreened', 'evaluated'])
    expect(results.every(j => j.status === 'prescreened' || j.status === 'evaluated')).toBe(true)
    expect(results.some(j => j.status === 'skipped')).toBe(false)
  })
})

// ── updateJobStatus ───────────────────────────────────────────────────────────

describe('updateJobStatus', () => {
  it('updates status', () => {
    const { id } = upsertJob(nextJob({ status: 'prescreened' }))
    updateJobStatus(id, 'evaluated')
    expect(getJob(id)?.status).toBe('evaluated')
  })

  it('updates score and archetype when provided', () => {
    const { id } = upsertJob(nextJob())
    updateJobStatus(id, 'evaluated', { score: 4.2, archetype: 'fullstack' })
    const job = getJob(id)
    expect(job?.score).toBe(4.2)
    expect(job?.archetype).toBe('fullstack')
  })

  it('updates skip_reason when provided', () => {
    const { id } = upsertJob(nextJob())
    updateJobStatus(id, 'skipped', { skip_reason: 'Too junior' })
    expect(getJob(id)?.skip_reason).toBe('Too junior')
  })
})

// ── jobs_content ──────────────────────────────────────────────────────────────

describe('upsertJobContent / getJobContent', () => {
  it('roundtrips raw and cleaned content', () => {
    const { id } = upsertJob(nextJob())
    upsertJobContent(id, '<p>Raw HTML</p>', '# Cleaned markdown')
    const content = getJobContent(id)
    expect(content?.raw_text).toBe('<p>Raw HTML</p>')
    expect(content?.cleaned_md).toBe('# Cleaned markdown')
  })

  it('returns undefined for unknown job id', () => {
    expect(getJobContent(999999)).toBeUndefined()
  })

  it('upserts on conflict (overrides previous content)', () => {
    const { id } = upsertJob(nextJob())
    upsertJobContent(id, 'old', 'old md')
    upsertJobContent(id, 'new', 'new md')
    expect(getJobContent(id)?.raw_text).toBe('new')
  })
})

// ── field mappings ────────────────────────────────────────────────────────────

describe('lookupFieldMapping', () => {
  it('returns null for an unknown question', () => {
    expect(lookupFieldMapping('This question was never saved xyz-unique')).toBeNull()
  })

  it('returns the saved answer', () => {
    saveFieldMapping('What is your email?', 'test@example.com')
    expect(lookupFieldMapping('What is your email?')).toBe('test@example.com')
  })

  it('is case-insensitive for question text', () => {
    saveFieldMapping('First Name', 'Dave')
    expect(lookupFieldMapping('first name')).toBe('Dave')
    expect(lookupFieldMapping('FIRST NAME')).toBe('Dave')
  })
})

describe('saveFieldMapping', () => {
  it('upserts — second save overrides the answer', () => {
    saveFieldMapping('Phone Number', '555-1234')
    saveFieldMapping('Phone Number', '555-9999')
    expect(lookupFieldMapping('Phone Number')).toBe('555-9999')
  })
})

describe('saveFieldMappingIfMissing', () => {
  it('returns true and saves when question is new', () => {
    const saved = saveFieldMappingIfMissing('New unique question?', 'yes')
    expect(saved).toBe(true)
    expect(lookupFieldMapping('New unique question?')).toBe('yes')
  })

  it('returns false and does not overwrite when question exists', () => {
    saveFieldMapping('Existing question?', 'original')
    const saved = saveFieldMappingIfMissing('Existing question?', 'override')
    expect(saved).toBe(false)
    expect(lookupFieldMapping('Existing question?')).toBe('original')
  })

  it('returns false when answer is empty string', () => {
    expect(saveFieldMappingIfMissing('Some question?', '')).toBe(false)
  })
})

describe('field mappings — variant partitioning', () => {
  it('stores different answers per variant for the same question', () => {
    saveFieldMapping('Preferred name on legal docs?', 'David Lovecchio', 'generic')
    saveFieldMapping('Preferred name on legal docs?', 'Dr. David Lovecchio', 'healthcare')
    expect(lookupFieldMapping('Preferred name on legal docs?', 'generic')).toBe('David Lovecchio')
    expect(lookupFieldMapping('Preferred name on legal docs?', 'healthcare')).toBe('Dr. David Lovecchio')
  })

  it('lookup defaults to generic when variant is omitted', () => {
    saveFieldMapping('Default-variant question?', 'generic-answer')
    expect(lookupFieldMapping('Default-variant question?')).toBe('generic-answer')
  })

  it('saveFieldMappingIfMissing scoped to variant — same question can be seeded per variant', () => {
    expect(saveFieldMappingIfMissing('Per-variant onboarding?', 'A', 'generic')).toBe(true)
    expect(saveFieldMappingIfMissing('Per-variant onboarding?', 'B', 'healthcare')).toBe(true)
    expect(saveFieldMappingIfMissing('Per-variant onboarding?', 'C', 'generic')).toBe(false)
    expect(lookupFieldMapping('Per-variant onboarding?', 'generic')).toBe('A')
    expect(lookupFieldMapping('Per-variant onboarding?', 'healthcare')).toBe('B')
  })
})

// ── eval failure tracking ─────────────────────────────────────────────────────

describe('recordEvalFailure', () => {
  it('increments eval_attempts and stores the error on first failure', () => {
    const { id } = upsertJob(nextJob())
    const result = recordEvalFailure(id, 'Network timeout')
    expect(result).toEqual({ attempts: 1, skipped: false })
    const job = getJob(id)!
    expect(job.eval_attempts).toBe(1)
    expect(job.eval_last_error).toBe('Network timeout')
    expect(job.eval_last_error_kind).toBe('other')
    expect(job.status).toBe('prescreened')
  })

  it('skips=false on the second attempt', () => {
    const { id } = upsertJob(nextJob())
    recordEvalFailure(id, 'fail 1')
    const result = recordEvalFailure(id, 'fail 2')
    expect(result).toEqual({ attempts: 2, skipped: false })
    expect(getJob(id)!.status).toBe('prescreened')
  })

  it(`auto-skips on the ${MAX_EVAL_ATTEMPTS}rd attempt with eval_failed: prefix`, () => {
    const { id } = upsertJob(nextJob())
    recordEvalFailure(id, 'fail 1')
    recordEvalFailure(id, 'fail 2')
    const result = recordEvalFailure(id, 'fail 3')
    expect(result.skipped).toBe(true)
    expect(result.attempts).toBe(MAX_EVAL_ATTEMPTS)
    const job = getJob(id)!
    expect(job.status).toBe('skipped')
    expect(job.skip_reason).toMatch(/^eval_failed: fail 3/)
  })

  it('does NOT auto-skip on credit-shaped errors even after the threshold', () => {
    const { id } = upsertJob(nextJob())
    recordEvalFailure(id, 'credit balance too low', { kind: 'credits' })
    recordEvalFailure(id, 'credit balance too low', { kind: 'credits' })
    const result = recordEvalFailure(id, 'credit balance too low', { kind: 'credits' })
    expect(result).toEqual({ attempts: MAX_EVAL_ATTEMPTS, skipped: false })
    expect(getJob(id)!.status).toBe('prescreened')
  })

  it('does NOT auto-skip on rate_limit or auth errors', () => {
    const a = upsertJob(nextJob({ external_id: 'rl-job' })).id
    recordEvalFailure(a, '429', { kind: 'rate_limit' })
    recordEvalFailure(a, '429', { kind: 'rate_limit' })
    expect(recordEvalFailure(a, '429', { kind: 'rate_limit' }).skipped).toBe(false)
    expect(getJob(a)!.status).toBe('prescreened')

    const b = upsertJob(nextJob({ external_id: 'auth-job' })).id
    recordEvalFailure(b, '401', { kind: 'auth' })
    recordEvalFailure(b, '401', { kind: 'auth' })
    expect(recordEvalFailure(b, '401', { kind: 'auth' }).skipped).toBe(false)
    expect(getJob(b)!.status).toBe('prescreened')
  })

  it('truncates the stored error message at 500 chars', () => {
    const { id } = upsertJob(nextJob())
    const long = 'X'.repeat(2000)
    recordEvalFailure(id, long)
    expect(getJob(id)!.eval_last_error?.length).toBe(500)
  })
})

describe('clearEvalFailure', () => {
  it('zeroes the counter and nulls the error fields', () => {
    const { id } = upsertJob(nextJob())
    recordEvalFailure(id, 'something broke')
    expect(getJob(id)!.eval_attempts).toBe(1)
    clearEvalFailure(id)
    const job = getJob(id)!
    expect(job.eval_attempts).toBe(0)
    expect(job.eval_last_error).toBeNull()
    expect(job.eval_last_error_kind).toBeNull()
    expect(job.eval_last_attempted_at).toBeNull()
  })
})

describe('commitEvaluation', () => {
  it('atomically saves an evaluation, resets the counter, and updates status', () => {
    const { id } = upsertJob(nextJob())
    // Seed prior failures
    recordEvalFailure(id, 'transient')
    recordEvalFailure(id, 'transient')
    expect(getJob(id)!.eval_attempts).toBe(2)

    commitEvaluation({
      evaluation: { job_id: id, model: 'haiku', prompt_tokens: 0, completion_tokens: 0, score: 4, verdict_md: 'looks good', raw_response: '{}' },
      jobId: id,
      statusUpdate: {
        status: 'evaluated',
        score: 4,
        score_reason: 'looks good',
        evaluated_at: new Date().toISOString(),
      },
    })

    const job = getJob(id)!
    expect(job.status).toBe('evaluated')
    expect(job.score).toBe(4)
    expect(job.eval_attempts).toBe(0)
    expect(job.eval_last_error).toBeNull()

    const evalRow = db.prepare('SELECT * FROM evaluations WHERE job_id = ?').get(id) as { score: number; profile_variant: string }
    expect(evalRow.score).toBe(4)
  })

  it('persists a secondary evaluation when provided (dual-eval ambiguous case)', () => {
    const { id } = upsertJob(nextJob())
    commitEvaluation({
      evaluation: { job_id: id, model: 'haiku', prompt_tokens: 0, completion_tokens: 0, score: 4, verdict_md: '', raw_response: '{}', profile_variant: 'healthcare' },
      secondary: { job_id: id, model: 'haiku', prompt_tokens: 0, completion_tokens: 0, score: 3, verdict_md: '', raw_response: '{}', profile_variant: 'generic' },
      jobId: id,
      statusUpdate: { status: 'evaluated', score: 4 },
    })
    const rows = db.prepare('SELECT profile_variant, score FROM evaluations WHERE job_id = ? ORDER BY profile_variant').all(id) as Array<{ profile_variant: string; score: number }>
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.profile_variant).sort()).toEqual(['generic', 'healthcare'])
  })
})
