import { describe, it, expect } from 'vitest'
import { extractCompSnippet } from '../claude/evaluator.js'

describe('extractCompSnippet', () => {
  it('finds an explicit annual range', () => {
    const jd = 'Some intro.\nThe compensation range for this position is $195,000 - $225,000 annually.\nMore prose.'
    const out = extractCompSnippet(jd)
    expect(out).toMatch(/\$195,000/)
    expect(out).toMatch(/\$225,000/)
  })

  it('finds a K-shorthand range', () => {
    const jd = 'Pay: $180K - $240K + equity.'
    expect(extractCompSnippet(jd)).toMatch(/\$180K[^$]+\$240K/)
  })

  it('finds a single base figure with money context', () => {
    const jd = 'We offer a competitive base salary around $210K, depending on experience.'
    const out = extractCompSnippet(jd)
    expect(out).toMatch(/\$210K/)
  })

  it('finds comp when it appears late in a long JD (past 3000 chars)', () => {
    const filler = 'x'.repeat(5000)
    const jd = `${filler}\nThe base salary range is $200,000 - $260,000 per year.`
    const out = extractCompSnippet(jd)
    expect(out).toMatch(/\$200,000/)
  })

  it('returns null for vague "competitive" with no dollar amount', () => {
    const jd = 'We offer competitive compensation and great benefits.'
    expect(extractCompSnippet(jd)).toBeNull()
  })

  it('returns null for "DOE"/"TBD" without a number', () => {
    expect(extractCompSnippet('Compensation DOE')).toBeNull()
    expect(extractCompSnippet('Salary: TBD')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(extractCompSnippet('')).toBeNull()
  })

  it('does not return monstrously long matches', () => {
    const jd = 'Compensation range is $195,000 - $225,000 annually plus equity and benefits — ' + 'x'.repeat(500)
    const out = extractCompSnippet(jd)
    expect(out!.length).toBeLessThanOrEqual(200)
  })
})
