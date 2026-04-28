export type IndustryVertical = 'healthcare' | 'generic' | 'ambiguous'

export interface ClassifyInput {
  title: string
  description: string
  company?: string
}

export interface ClassifyResult {
  vertical: IndustryVertical
  hits: number
  matchedKeywords: string[]
}

const HEALTHCARE_KEYWORDS = [
  'healthcare', 'health tech', 'health-tech', 'healthtech', 'digital health',
  'ehr', 'emr', 'electronic health record',
  'telehealth', 'telemedicine', 'virtual care',
  'clinical', 'clinician', 'physician', 'patient', 'provider',
  'hospital', 'health system', 'health systems',
  'hipaa', 'phi', 'protected health information',
  'epic', 'cerner', 'allscripts', 'meditech', 'athenahealth',
  'medicare', 'medicaid', 'payer', 'payor',
  'pharmaceutical', 'pharma', 'biotech', 'medical device',
  'eprescribe', 'icd', 'cpt',
] as const

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const KEYWORD_PATTERNS: Array<{ keyword: string; re: RegExp }> = HEALTHCARE_KEYWORDS.map((kw) => ({
  keyword: kw,
  re: new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i'),
}))

export function classifyVertical(job: ClassifyInput): IndustryVertical {
  return classifyVerticalDetailed(job).vertical
}

export function classifyVerticalDetailed(job: ClassifyInput): ClassifyResult {
  const text = `${job.title} ${job.description} ${job.company ?? ''}`
  const matched = new Set<string>()
  for (const { keyword, re } of KEYWORD_PATTERNS) {
    if (re.test(text)) matched.add(keyword)
  }
  const hits = matched.size
  let vertical: IndustryVertical
  if (hits >= 3) vertical = 'healthcare'
  else if (hits === 0) vertical = 'generic'
  else vertical = 'ambiguous'
  return { vertical, hits, matchedKeywords: [...matched] }
}
