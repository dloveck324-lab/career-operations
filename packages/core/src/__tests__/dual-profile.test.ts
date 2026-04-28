import { describe, it, expect } from 'vitest'
import { loadProfile, loadProfileVariant, loadCv } from '../config'

describe('dual-profile loaders', () => {
  it('loadProfile returns top-level narrative', () => {
    const p = loadProfile()
    expect(p?.narrative.headline).toMatch(/Director-level/)
  })
  it('loadProfileVariant(healthcare) overlays healthcare narrative', () => {
    const p = loadProfileVariant('healthcare')
    expect(p?.narrative.headline).toMatch(/healthcare \(J&J\)/)
    expect(p?.narrative.superpowers?.some(s => s.includes('EHR'))).toBe(true)
  })
  it('loadProfileVariant(generic) overlays generic narrative', () => {
    const p = loadProfileVariant('generic')
    expect(p?.narrative.headline).toMatch(/Fortune 50 enterprises/)
    expect(p?.narrative.superpowers?.some(s => s.includes('Furniture Curator'))).toBe(true)
  })
  it('loadCv() returns cv.md (no arg, backward compat)', () => {
    const cv = loadCv()
    expect(cv).toBeTruthy()
  })
  it('loadCv(healthcare) returns cv-healthcare.md', () => {
    const cv = loadCv('healthcare')
    expect(cv).toBeTruthy()
  })
  it('loadCv(generic) returns cv-generic.md', () => {
    const cv = loadCv('generic')
    expect(cv).toBeTruthy()
  })
})
