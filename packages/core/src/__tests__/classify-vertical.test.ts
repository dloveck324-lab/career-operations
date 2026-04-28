import { describe, it, expect } from 'vitest'
import { classifyVertical, classifyVerticalDetailed } from '../classify-vertical'

describe('classifyVertical', () => {
  describe('healthcare (>=3 keyword hits)', () => {
    it('classifies a clinical EHR product role', () => {
      expect(
        classifyVertical({
          title: 'Director of Product, Clinical Workflows',
          description:
            'Lead our EHR integration roadmap with Epic and Cerner. Partner with clinicians and physicians at hospital customers.',
          company: 'eVisit',
        }),
      ).toBe('healthcare')
    })

    it('classifies a telehealth role with HIPAA + payer mentions', () => {
      expect(
        classifyVertical({
          title: 'Senior PM, Telehealth Platform',
          description:
            'Drive HIPAA-compliant virtual care features across Medicare and Medicaid payer integrations.',
        }),
      ).toBe('healthcare')
    })

    it('counts unique keywords (duplicates do not double-count)', () => {
      const result = classifyVerticalDetailed({
        title: 'PM, Healthcare',
        description: 'healthcare healthcare healthcare',
      })
      expect(result.hits).toBe(1)
      expect(result.vertical).toBe('ambiguous')
    })
  })

  describe('generic (0 keyword hits)', () => {
    it('classifies a fintech role with no healthcare signals', () => {
      expect(
        classifyVertical({
          title: 'Senior Product Manager',
          description:
            'Build payment infrastructure for B2B SaaS companies. Drive revenue growth and lead a cross-functional team.',
          company: 'Stripe',
        }),
      ).toBe('generic')
    })

    it('classifies a generic SaaS PM role', () => {
      expect(
        classifyVertical({
          title: 'Director of Product',
          description:
            'Own the roadmap for our analytics platform. Collaborate with engineering, design, and go-to-market teams.',
        }),
      ).toBe('generic')
    })
  })

  describe('ambiguous (1-2 keyword hits)', () => {
    it('classifies B2B SaaS that mentions one healthcare customer', () => {
      const result = classifyVerticalDetailed({
        title: 'Senior Product Manager, Enterprise',
        description:
          'Build customer-facing features for our B2B SaaS platform. Customers include retail, fintech, and one large hospital system.',
      })
      expect(result.vertical).toBe('ambiguous')
      expect(result.hits).toBeGreaterThanOrEqual(1)
      expect(result.hits).toBeLessThanOrEqual(2)
    })

    it('flags a marketing-tools role that mentions "patient acquisition" once', () => {
      const result = classifyVerticalDetailed({
        title: 'Product Manager, Growth',
        description:
          'Run experiments to drive patient acquisition for our marketing platform.',
      })
      expect(result.vertical).toBe('ambiguous')
    })
  })

  describe('word-boundary protection', () => {
    it('does not match "phi" inside "philadelphia"', () => {
      const result = classifyVerticalDetailed({
        title: 'Product Manager',
        description: 'Remote with occasional travel to Philadelphia.',
      })
      expect(result.matchedKeywords).not.toContain('phi')
    })

    it('does not match "ehr" inside "rehearse"', () => {
      const result = classifyVerticalDetailed({
        title: 'PM',
        description: 'You will rehearse demos with our enterprise team.',
      })
      expect(result.matchedKeywords).not.toContain('ehr')
    })

    it('does not match "icd" or "cpt" as substrings', () => {
      const result = classifyVerticalDetailed({
        title: 'Captain of Industry',
        description: 'icdh and cptable are not real keywords here.',
      })
      expect(result.matchedKeywords).not.toContain('icd')
      expect(result.matchedKeywords).not.toContain('cpt')
    })
  })

  describe('case insensitivity', () => {
    it('matches keywords regardless of case', () => {
      expect(
        classifyVertical({
          title: 'PM, HEALTHCARE',
          description: 'EHR. CLINICIAN. HIPAA.',
        }),
      ).toBe('healthcare')
    })
  })

  describe('return shape', () => {
    it('classifyVerticalDetailed returns vertical + hits + matchedKeywords', () => {
      const result = classifyVerticalDetailed({
        title: 'PM, Telehealth',
        description: 'Build telehealth features for clinicians.',
      })
      expect(result).toMatchObject({
        vertical: expect.any(String),
        hits: expect.any(Number),
      })
      expect(Array.isArray(result.matchedKeywords)).toBe(true)
    })
  })
})
