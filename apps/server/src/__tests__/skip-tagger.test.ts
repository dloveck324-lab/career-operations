import { vi, describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'

// vi.mock factories are hoisted above top-level code; use vi.hoisted() so the
// mock reference is in scope at factory evaluation time.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('child_process', () => ({ spawn: spawnMock }))

import { extractSkipTags } from '../claude/skip-tagger.js'

/** Build a fake ChildProcess that emits the given stdout and closes with exitCode. */
function fakeProcess(stdout: string, exitCode = 0): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()
  ;(proc as unknown as Record<string, unknown>).stdout = stdoutEmitter
  ;(proc as unknown as Record<string, unknown>).stderr = stderrEmitter
  ;(proc as unknown as Record<string, unknown>).kill = vi.fn()

  setImmediate(() => {
    if (stdout) stdoutEmitter.emit('data', Buffer.from(stdout))
    proc.emit('close', exitCode)
  })
  return proc
}

describe('extractSkipTags', () => {
  it('parses a valid JSON response from Claude', async () => {
    spawnMock.mockReturnValueOnce(
      fakeProcess(JSON.stringify({ category: 'language_requirement', keywords: ['french', 'bilingual'] })),
    )
    const tags = await extractSkipTags('requires fluency in French and English')
    expect(tags.category).toBe('language_requirement')
    expect(tags.keywords).toEqual(['french', 'bilingual'])
  })

  it('accepts JSON wrapped in markdown code fences', async () => {
    const body = '```json\n{"category":"location_mismatch","keywords":["nyc","on-site"]}\n```'
    spawnMock.mockReturnValueOnce(fakeProcess(body))
    const tags = await extractSkipTags('must be in NYC office 5 days a week')
    expect(tags.category).toBe('location_mismatch')
    expect(tags.keywords).toContain('nyc')
  })

  it('returns fallback on malformed JSON without throwing', async () => {
    spawnMock.mockReturnValueOnce(fakeProcess('this is not json'))
    const tags = await extractSkipTags('some reason')
    expect(tags).toEqual({ category: 'other', keywords: [] })
  })

  it('returns fallback when CLI exits non-zero without throwing', async () => {
    spawnMock.mockReturnValueOnce(fakeProcess('', 1))
    const tags = await extractSkipTags('some reason')
    expect(tags).toEqual({ category: 'other', keywords: [] })
  })

  it('clamps keywords to at most 3 entries', async () => {
    spawnMock.mockReturnValueOnce(
      fakeProcess(JSON.stringify({ category: 'other', keywords: ['a', 'b', 'c', 'd', 'e'] })),
    )
    const tags = await extractSkipTags('some reason')
    expect(tags.keywords).toHaveLength(3)
  })

  it('falls back to "other" for an unknown category string', async () => {
    spawnMock.mockReturnValueOnce(
      fakeProcess(JSON.stringify({ category: 'not_real_category', keywords: [] })),
    )
    const tags = await extractSkipTags('some reason')
    expect(tags.category).toBe('other')
  })

  it('handles JSON embedded in prose wrapper', async () => {
    const body = 'Here is the classification:\n{"category":"certification_required","keywords":["aws"]}\nDone.'
    spawnMock.mockReturnValueOnce(fakeProcess(body))
    const tags = await extractSkipTags('must have AWS cert')
    expect(tags.category).toBe('certification_required')
    expect(tags.keywords).toContain('aws')
  })
})
