import { describe, it, expect } from 'vitest'
import { RunRegistry } from '../autofill/runs.js'

describe('RunRegistry — profile variant', () => {
  it('stores the variant passed at create time', () => {
    const reg = new RunRegistry()
    const run = reg.create(42, 'haiku', 'healthcare')
    expect(run.variant).toBe('healthcare')
    expect(reg.get(run.id)?.variant).toBe('healthcare')
  })

  it('defaults to generic when variant is omitted', () => {
    const reg = new RunRegistry()
    const run = reg.create(42, 'haiku')
    expect(run.variant).toBe('generic')
  })

  it('keeps separate variants on separate jobs', () => {
    const reg = new RunRegistry()
    const hc = reg.create(1, 'haiku', 'healthcare')
    const gn = reg.create(2, 'haiku', 'generic')
    expect(reg.get(hc.id)?.variant).toBe('healthcare')
    expect(reg.get(gn.id)?.variant).toBe('generic')
  })
})
