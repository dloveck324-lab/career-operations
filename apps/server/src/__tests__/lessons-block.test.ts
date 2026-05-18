import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../db/schema.js', () => import('./helpers/testDb.js'))

import { db } from './helpers/testDb.js'
import { upsertJob, saveEvaluation, insertEvalFeedback, getRecentLessons } from '../db/queries.js'
import { loadLessonsBlock } from '../claude/evaluator.js'
import type { JobStatus } from '../db/queries.js'

const BASE_JOB = {
  source: 'greenhouse',
  url: 'https://example.com/job/1',
  company: 'Acme',
  title: 'PM',
  external_id: 'ext-1',
  location: 'Remote',
  remote_policy: 'remote',
  comp_text: undefined,
  description_hash: undefined,
  status: 'prescreened' as JobStatus,
  archetype: undefined,
  score: undefined,
  score_reason: undefined,
  skip_reason: undefined,
  evaluated_at: undefined,
  applied_at: undefined,
}

beforeEach(() => {
  db.exec(`DELETE FROM eval_feedback; DELETE FROM evaluations; DELETE FROM jobs;`)
})

function seedFeedback(flag_text: string, correction: string) {
  const { id: jobId } = upsertJob({ ...BASE_JOB, external_id: `ext-${flag_text.length}-${Math.random()}` })
  const evalId = saveEvaluation({ job_id: jobId, model: 'haiku', score: 4 })
  insertEvalFeedback({
    evaluation_id: evalId,
    job_id: jobId,
    flag_type: 'red',
    flag_text,
    correction,
  })
}

describe('feedback lessons loop', () => {
  it('getRecentLessons returns the most recent corrections, deduped by flag_text', () => {
    seedFeedback('Compensation not listed', 'Comp is $195K-$225K — scan the whole JD next time.')
    seedFeedback('Compensation not listed', 'Updated note: $200K range present.') // dedupes
    seedFeedback('Equity unclear', 'Equity is standard YC.')

    const lessons = getRecentLessons(10)
    expect(lessons).toHaveLength(2)
    const compLesson = lessons.find(l => l.flag_text === 'Compensation not listed')
    expect(compLesson?.correction).toMatch(/\$200K|\$195K/)
  })

  it('loadLessonsBlock returns empty string when no feedback exists', () => {
    expect(loadLessonsBlock()).toBe('')
  })

  it('loadLessonsBlock renders a labeled block with bullets when feedback exists', () => {
    seedFeedback('Compensation not listed', 'Comp is in JD body: $195K-$225K')
    const block = loadLessonsBlock()
    expect(block).toContain('LESSONS FROM PRIOR FEEDBACK')
    expect(block).toContain('Compensation not listed')
    expect(block).toContain('$195K-$225K')
  })

  it('skips lessons without a correction (no actionable guidance)', () => {
    const { id: jobId } = upsertJob({ ...BASE_JOB, external_id: 'ext-no-corr' })
    const evalId = saveEvaluation({ job_id: jobId, model: 'haiku', score: 4 })
    insertEvalFeedback({
      evaluation_id: evalId,
      job_id: jobId,
      flag_type: 'red',
      flag_text: 'Vague flag',
    })
    expect(getRecentLessons()).toHaveLength(0)
  })
})
