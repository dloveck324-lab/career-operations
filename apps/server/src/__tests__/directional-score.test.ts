import { describe, it, expect } from 'vitest'
import { computeDirectionalScore } from '../scanner/directional-score.js'
import type { ProfileConfig } from '@job-pipeline/core'

const baseProfile: ProfileConfig = {
  candidate: { full_name: 'Test', email: 't@t.com' },
  target_roles: {
    primary: ['Director of Product'],
    archetypes: [
      { name: 'Director of Product', level: 'Director', fit: 'primary' },
      { name: 'Senior Product Manager', level: 'Senior', fit: 'secondary' },
    ],
  },
  narrative: { headline: 'Test' },
  compensation: { target_range: '$1', currency: 'USD', minimum: '$1' },
  location: { country: 'US', city: 'X', timezone: 'PT' },
  prescreen: {
    archetype_keywords: {
      healthcare: ['healthcare', 'EHR', 'telehealth'],
      saas: ['SaaS', 'B2B', 'platform'],
      ai: ['AI product', 'LLM'],
    },
  },
}

describe('computeDirectionalScore', () => {
  it('returns 0 when profile is null', () => {
    expect(computeDirectionalScore(null, { title: 'PM', description: 'AI' })).toBe(0)
  })

  it('returns 0 when no keywords match', () => {
    expect(
      computeDirectionalScore(baseProfile, {
        title: 'Sales Engineer',
        description: 'Cold call enterprise customers',
      }),
    ).toBe(0)
  })

  it('counts unique matched keywords across title + description + company', () => {
    expect(
      computeDirectionalScore(baseProfile, {
        title: 'Director of Product, AI Platform',
        description: 'Build B2B SaaS infrastructure with LLM features.',
        company: 'Acme',
      }),
    ).toBe(5) // Director of Product, AI product (no — "AI product" needs both words), SaaS, B2B, platform, LLM → 5 distinct
  })

  it('caps at 10', () => {
    const richProfile: ProfileConfig = {
      ...baseProfile,
      prescreen: {
        archetype_keywords: {
          all: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'],
        },
      },
    }
    const desc = 'a b c d e f g h i j k l'
    expect(computeDirectionalScore(richProfile, { title: 'X', description: desc })).toBe(10)
  })

  it('uses word-boundary matching (case-insensitive)', () => {
    expect(
      computeDirectionalScore(baseProfile, {
        title: 'PM',
        description: 'rehearsal at the saaspirations conference', // "EHR" not in "rehearsal", "SaaS" not in "saaspirations"
      }),
    ).toBe(0)
  })

  it('does not double-count repeated keywords', () => {
    expect(
      computeDirectionalScore(baseProfile, {
        title: 'B2B PM',
        description: 'B2B B2B B2B B2B B2B',
      }),
    ).toBe(1)
  })

  it('matches archetype names', () => {
    expect(
      computeDirectionalScore(baseProfile, {
        title: 'Senior Product Manager, Growth',
        description: 'Run experiments.',
      }),
    ).toBe(1)
  })
})
