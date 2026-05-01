import { describe, it, expect } from 'vitest'
import { evaluateCompleteness } from '../useProfileCompleteness.js'

describe('evaluateCompleteness', () => {
  const COMPLETE = {
    candidate: { full_name: 'Jane Doe', email: 'jane@example.com' },
    target_roles: { primary: ['Senior PM'] },
    compensation: { target_range: '$150K-$200K' },
    prescreen: { blocklist_titles: ['intern', 'junior'] },
  }

  it('returns no incomplete fields for a fully populated profile', () => {
    expect(evaluateCompleteness(COMPLETE)).toEqual([])
  })

  it('flags missing full_name to the CV tab', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, candidate: { ...COMPLETE.candidate, full_name: '' } })
    expect(incomplete).toEqual([{ tab: 0, label: 'Full name' }])
  })

  it('treats the public-template "Your Name" as a placeholder', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, candidate: { ...COMPLETE.candidate, full_name: 'Your Name' } })
    expect(incomplete).toContainEqual({ tab: 0, label: 'Full name' })
  })

  it('treats the public-template "you@example.com" as a placeholder', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, candidate: { ...COMPLETE.candidate, email: 'you@example.com' } })
    expect(incomplete).toContainEqual({ tab: 0, label: 'Email' })
  })

  it('flags missing primary roles to the Profile tab', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, target_roles: { primary: [] } })
    expect(incomplete).toContainEqual({ tab: 1, label: 'Target roles' })
  })

  it('treats whitespace-only primary roles as empty', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, target_roles: { primary: ['   ', ''] } })
    expect(incomplete).toContainEqual({ tab: 1, label: 'Target roles' })
  })

  it('flags missing target_range to the Profile tab', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, compensation: { target_range: '' } })
    expect(incomplete).toContainEqual({ tab: 1, label: 'Target compensation' })
  })

  it('flags missing blocklist_titles to the Scan tab', () => {
    const incomplete = evaluateCompleteness({ ...COMPLETE, prescreen: { blocklist_titles: [] } })
    expect(incomplete).toContainEqual({ tab: 2, label: 'Title blocklist' })
  })

  it('returns all five fields when given a brand-new placeholder profile', () => {
    const incomplete = evaluateCompleteness({
      candidate: { full_name: 'Your Name', email: 'you@example.com' },
      target_roles: { primary: [] },
      compensation: { target_range: '' },
      prescreen: { blocklist_titles: [] },
    })
    expect(incomplete).toHaveLength(5)
    expect(incomplete.map(f => f.tab).sort()).toEqual([0, 0, 1, 1, 2])
  })

  it('handles a null profile gracefully (no crash, all fields flagged)', () => {
    const incomplete = evaluateCompleteness(null)
    expect(incomplete).toHaveLength(5)
  })
})
