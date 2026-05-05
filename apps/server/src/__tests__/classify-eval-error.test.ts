import { describe, it, expect } from 'vitest'
import { classifyEvalError } from '../claude/evaluator.js'

describe('classifyEvalError', () => {
  it('detects credit exhaustion phrasing', () => {
    expect(classifyEvalError('Error: insufficient credit balance')).toBe('credits')
    expect(classifyEvalError('your credit balance is too low')).toBe('credits')
    expect(classifyEvalError('HTTP 402 payment required')).toBe('credits')
    expect(classifyEvalError('insufficient quota')).toBe('credits')
  })

  it('detects rate limits', () => {
    expect(classifyEvalError('Rate limit exceeded')).toBe('rate_limit')
    expect(classifyEvalError('429 Too Many Requests')).toBe('rate_limit')
    expect(classifyEvalError('rate-limited by provider')).toBe('rate_limit')
  })

  it('detects parse errors', () => {
    expect(classifyEvalError('No JSON object found in Claude response')).toBe('parse')
    expect(classifyEvalError('Unexpected token < in JSON')).toBe('parse')
  })

  it('detects auth errors', () => {
    expect(classifyEvalError('HTTP 401 Unauthorized')).toBe('auth')
    expect(classifyEvalError('Invalid API key')).toBe('auth')
    expect(classifyEvalError('authentication failed')).toBe('auth')
  })

  it('falls back to "other" for unrecognized errors', () => {
    expect(classifyEvalError('Network timeout')).toBe('other')
    expect(classifyEvalError('Connection refused')).toBe('other')
    expect(classifyEvalError('')).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(classifyEvalError('CREDIT BALANCE TOO LOW')).toBe('credits')
    expect(classifyEvalError('RATE LIMIT')).toBe('rate_limit')
  })
})
