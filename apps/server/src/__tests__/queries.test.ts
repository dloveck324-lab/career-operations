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
