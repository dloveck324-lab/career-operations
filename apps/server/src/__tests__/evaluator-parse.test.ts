import { describe, it, expect } from 'vitest'
import { parseEvalResponse } from '../claude/evaluator.js'

describe('parseEvalResponse', () => {
  it('parses a complete JSON response', () => {
    const raw = JSON.stringify({
      score: 4,
      archetype: 'fullstack',
      cv_match: 3.5,
      north_star: 4.5,
      comp: 4,
      cultural_signals: 3,
      verdict: 'Good match overall.',
      green_flags: ['Strong TypeScript', 'Remote friendly'],
      red_flags: ['Equity unclear'],
    })

    const result = parseEvalResponse(raw, 'claude-haiku-4-5-20251001')

    expect(result.score).toBe(4)
    expect(result.archetype).toBe('fullstack')
    expect(result.cv_match).toBe(3.5)
    expect(result.north_star).toBe(4.5)
    expect(result.comp).toBe(4)
    expect(result.cultural_signals).toBe(3)
    expect(result.model).toBe('claude-haiku-4-5-20251001')
    expect(result.verdict_md).toContain('Experience 3.5')
    expect(result.verdict_md).toContain('Role Fit 4.5')
    expect(result.verdict_md).toContain('Good match overall.')
    expect(result.verdict_md).toContain('Strong TypeScript')
    expect(result.verdict_md).toContain('Equity unclear')
  })

  it('strips markdown code block wrapper', () => {
    const raw = '```json\n{"score": 3, "verdict": "ok"}\n```'
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.score).toBe(3)
  })

  it('extracts JSON from prose surrounding the response', () => {
    const raw = 'Here is the evaluation:\n{"score": 4, "verdict": "Good fit"}\nThat is my assessment.'
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.score).toBe(4)
  })

  it('clamps score above 5 down to 5', () => {
    const raw = JSON.stringify({ score: 9, verdict: 'over the top' })
    expect(parseEvalResponse(raw, 'test-model').score).toBe(5)
  })

  it('clamps score below 1 up to 1', () => {
    const raw = JSON.stringify({ score: 0, verdict: 'too low' })
    expect(parseEvalResponse(raw, 'test-model').score).toBe(1)
  })

  it('defaults score to 1 when missing', () => {
    const raw = JSON.stringify({ verdict: 'no score field' })
    expect(parseEvalResponse(raw, 'test-model').score).toBe(1)
  })

  it('returns null for missing dimension fields', () => {
    const raw = JSON.stringify({ score: 3, verdict: 'partial' })
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.cv_match).toBeNull()
    expect(result.north_star).toBeNull()
    expect(result.comp).toBeNull()
    expect(result.cultural_signals).toBeNull()
  })

  it('omits Pros/Cons sections when flags are empty', () => {
    const raw = JSON.stringify({ score: 3, verdict: 'Average.', green_flags: [], red_flags: [] })
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.verdict_md).not.toContain('Pros')
    expect(result.verdict_md).not.toContain('Cons')
  })

  it('omits dimension line when all dimensions are null', () => {
    const raw = JSON.stringify({ score: 3, verdict: 'Verdict only.' })
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.verdict_md.trim()).toBe('Verdict only.')
  })

  it('throws when no JSON found in response', () => {
    expect(() => parseEvalResponse('no json here at all', 'test-model')).toThrow('No JSON found')
  })

  it('returns raw_response truncated to 2000 chars', () => {
    const longRaw = JSON.stringify({ score: 3, verdict: 'x'.repeat(5000) })
    const result = parseEvalResponse(longRaw, 'test-model')
    expect(result.raw_response.length).toBeLessThanOrEqual(2000)
  })

  it('stores zeros for token counts (CLI does not expose them)', () => {
    const raw = JSON.stringify({ score: 3, verdict: 'ok' })
    const result = parseEvalResponse(raw, 'test-model')
    expect(result.prompt_tokens).toBe(0)
    expect(result.completion_tokens).toBe(0)
  })
})
