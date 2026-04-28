import type { ProfileConfig } from '@job-pipeline/core'

/**
 * Tier 1 directional score: 0–10, regex-derived, zero token cost.
 *
 * Counts unique competency keywords matched against the job text. The keyword
 * pool comes from profile.prescreen.archetype_keywords (designed for JD
 * matching) plus the explicit target archetype names.
 *
 * Future upgrade (option B): weight matches by archetype fit — primary >
 * secondary > unrelated. Skipping for now per the call locked on 2026-04-28;
 * revisit if directional sort feels misleading after a few weeks of use.
 */
const SCORE_CAP = 10

export interface DirectionalScoreInput {
  title: string
  description?: string
  company?: string
}

export function computeDirectionalScore(
  profile: ProfileConfig | null,
  job: DirectionalScoreInput,
): number {
  if (!profile) return 0
  const keywords = collectCompetencyKeywords(profile)
  if (keywords.length === 0) return 0

  const text = `${job.title} ${job.description ?? ''} ${job.company ?? ''}`
  const matched = new Set<string>()
  for (const kw of keywords) {
    const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i')
    if (re.test(text)) matched.add(kw.toLowerCase())
  }
  return Math.min(matched.size, SCORE_CAP)
}

function collectCompetencyKeywords(profile: ProfileConfig): string[] {
  const out = new Set<string>()
  const archetypeKeywords = profile.prescreen?.archetype_keywords ?? {}
  for (const list of Object.values(archetypeKeywords)) {
    for (const kw of list) if (kw.trim()) out.add(kw.trim())
  }
  for (const arch of profile.target_roles?.archetypes ?? []) {
    if (arch.name?.trim()) out.add(arch.name.trim())
  }
  return [...out]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
