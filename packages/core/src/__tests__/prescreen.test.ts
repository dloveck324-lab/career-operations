import { describe, it, expect } from 'vitest'
import { buildPrescreen } from '../prescreen.js'

describe('buildPrescreen — blocklist_titles', () => {
  const prescreen = buildPrescreen({ blocklist_titles: ['manager', 'director'] })

  it('blocks title containing blocklist word', () => {
    const r = prescreen({ title: 'Engineering Manager', location: 'Remote' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('blocklist match')
  })

  it('does not block partial-word match (manageable ≠ manager)', () => {
    const r = prescreen({ title: 'Product Manageable Lead', location: 'Remote' })
    expect(r.pass).toBe(true)
  })

  it('passes non-blocked title', () => {
    expect(prescreen({ title: 'Senior Engineer', location: 'Remote' }).pass).toBe(true)
  })
})

describe('buildPrescreen — title_filter', () => {
  const prescreen = buildPrescreen({
    title_filter: {
      positive: ['engineer', 'developer'],
      negative: ['intern', 'student'],
    },
  })

  it('blocks negative keyword', () => {
    const r = prescreen({ title: 'Software Intern', location: 'Remote' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('negative keyword')
  })

  it('blocks when no positive keyword matches', () => {
    const r = prescreen({ title: 'Product Manager', location: 'Remote' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('no positive title keywords')
  })

  it('passes when positive keyword matches', () => {
    expect(prescreen({ title: 'Senior Software Engineer', location: 'Remote' }).pass).toBe(true)
  })

  it('negative check runs before positive check', () => {
    // "intern" is negative even if "engineer" is also present
    const r = prescreen({ title: 'Intern Engineer', location: 'Remote' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('negative keyword')
  })
})

describe('buildPrescreen — seniority', () => {
  const prescreen = buildPrescreen({ seniority_min: 'senior' })

  it('blocks junior role', () => {
    const r = prescreen({ title: 'Junior Software Engineer', location: 'Remote' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('seniority')
  })

  it('blocks associate role', () => {
    expect(prescreen({ title: 'Associate Engineer', location: 'Remote' }).pass).toBe(false)
  })

  it('passes senior role (at minimum)', () => {
    expect(prescreen({ title: 'Senior Software Engineer', location: 'Remote' }).pass).toBe(true)
  })

  it('passes staff role (above minimum)', () => {
    expect(prescreen({ title: 'Staff Engineer', location: 'Remote' }).pass).toBe(true)
  })

  it('passes principal role (above minimum)', () => {
    expect(prescreen({ title: 'Principal Engineer', location: 'Remote' }).pass).toBe(true)
  })

  it('passes title with no detectable seniority', () => {
    expect(prescreen({ title: 'Software Engineer', location: 'Remote' }).pass).toBe(true)
  })
})

describe('buildPrescreen — comp_floor', () => {
  const prescreen = buildPrescreen({ comp_floor: 100_000 })

  it('blocks job below comp floor from description', () => {
    const r = prescreen({ title: 'Engineer', location: 'Remote', description: 'Salary: $80k/yr' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('compensation')
  })

  it('blocks job below comp floor from comp_text field', () => {
    const r = prescreen({ title: 'Engineer', location: 'Remote', comp_text: '$80k' })
    expect(r.pass).toBe(false)
  })

  it('passes job above comp floor', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote', description: 'Pay: $120k/yr' }).pass).toBe(true)
  })

  it('passes when comp mentions $150K (uppercase K)', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote', description: '$150K annual' }).pass).toBe(true)
  })

  it('passes when no comp mentioned', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote', description: 'Competitive salary' }).pass).toBe(true)
  })
})

describe('buildPrescreen — location_policy (defaults)', () => {
  const prescreen = buildPrescreen({})

  it('passes US remote job', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote, US' }).pass).toBe(true)
  })

  it('passes job with "remote" in location', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote' }).pass).toBe(true)
  })

  it('blocks non-US on-site job', () => {
    const r = prescreen({ title: 'Engineer', location: 'London, UK' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('non-US')
  })

  it('blocks on-site Berlin job', () => {
    expect(prescreen({ title: 'Engineer', location: 'Berlin, Germany' }).pass).toBe(false)
  })

  it('passes worldwide remote by default (worldwide_remote_ok defaults to true)', () => {
    expect(prescreen({ title: 'Engineer', location: 'Worldwide' }).pass).toBe(true)
  })

  it('passes US city on-site job', () => {
    expect(prescreen({ title: 'Engineer', location: 'San Francisco, CA' }).pass).toBe(true)
  })
})

describe('buildPrescreen — worldwide_remote_ok: false', () => {
  const prescreen = buildPrescreen({
    location_policy: { worldwide_remote_ok: false },
  })

  it('blocks worldwide location', () => {
    const r = prescreen({ title: 'Engineer', location: 'Worldwide' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('worldwide remote')
  })

  it('blocks "Anywhere" location', () => {
    expect(prescreen({ title: 'Engineer', location: 'Anywhere' }).pass).toBe(false)
  })

  it('still passes US remote', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote, United States' }).pass).toBe(true)
  })
})

describe('buildPrescreen — allowed_countries', () => {
  const prescreen = buildPrescreen({
    location_policy: {
      require_us_or_remote: true,
      allowed_countries: ['Canada'],
    },
  })

  it('passes remote job in allowed country', () => {
    expect(prescreen({ title: 'Engineer', location: 'Remote - Canada' }).pass).toBe(true)
  })

  it('blocks on-site job in allowed country', () => {
    const r = prescreen({ title: 'Engineer', location: 'Toronto, Canada' })
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('on-site')
  })

  it('blocks job in non-allowed non-US country', () => {
    expect(prescreen({ title: 'Engineer', location: 'London, UK' }).pass).toBe(false)
  })
})

describe('buildPrescreen — archetype_keywords', () => {
  const prescreen = buildPrescreen({
    archetype_keywords: {
      fullstack: ['react', 'node', 'typescript'],
      backend: ['golang', 'rust', 'distributed systems'],
    },
  })

  it('detects archetype with most keyword matches', () => {
    const r = prescreen({
      title: 'Engineer',
      location: 'Remote',
      description: 'Must know React, TypeScript, and Node.',
    })
    expect(r.pass).toBe(true)
    expect(r.archetype).toBe('fullstack')
  })

  it('prefers archetype with higher score', () => {
    const r = prescreen({
      title: 'Engineer',
      location: 'Remote',
      description: 'golang, rust, distributed systems, react',
    })
    expect(r.archetype).toBe('backend')
  })

  it('returns null archetype when no keywords match', () => {
    const r = prescreen({ title: 'Engineer', location: 'Remote', description: 'Python developer.' })
    expect(r.archetype).toBeNull()
  })
})

describe('buildPrescreen — no config', () => {
  const prescreen = buildPrescreen()

  it('passes any job with no restrictions', () => {
    expect(prescreen({ title: 'Anything', location: 'Remote' }).pass).toBe(true)
  })

  it('returns null archetype with no keywords configured', () => {
    expect(prescreen({ title: 'Anything', location: 'Remote' }).archetype).toBeNull()
  })
})
