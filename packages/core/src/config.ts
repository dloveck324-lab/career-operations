import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface CandidateProfile {
  full_name: string
  email: string
  phone?: string
  location?: string
  linkedin?: string
  portfolio_url?: string
  github?: string
  gender?: string
  pronouns?: string
  race_ethnicity?: string
  veteran_status?: string
  disability_status?: string
  work_authorization?: string
  requires_sponsorship?: string
  current_company?: string
  years_of_experience?: string
  how_did_you_hear?: string
}

export type ProfileVariant = 'healthcare' | 'generic'

export interface VariantNarrative {
  headline: string
  exit_story?: string
  superpowers?: string[]
  proof_points?: Array<{ name: string; url?: string; hero_metric?: string }>
}

export interface ProfileConfig {
  candidate: CandidateProfile
  target_roles: {
    primary: string[]
    archetypes: Array<{ name: string; level: string; fit: string }>
  }
  narrative: {
    headline: string
    exit_story?: string
    superpowers?: string[]
    proof_points?: Array<{ name: string; url?: string; hero_metric?: string }>
    variants?: Partial<Record<ProfileVariant, VariantNarrative>>
  }
  compensation: {
    target_range: string
    currency: string
    minimum: string
    location_flexibility?: string
  }
  location: {
    country: string
    city: string
    timezone: string
    visa_status?: string
  }
  prescreen: {
    seniority_min?: string
    comp_floor?: number
    location_policy?: {
      allow_onsite_cities?: string[]
      allowed_countries?: string[]
      require_remote_if_elsewhere?: boolean
      require_us_or_remote?: boolean
      worldwide_remote_ok?: boolean
    }
    blocklist_titles?: string[]
    archetype_keywords?: Record<string, string[]>
  }
}

export interface Portal {
  name: string
  type: 'greenhouse' | 'ashby' | 'lever' | 'workday' | 'custom'
  company_id?: string
  url?: string
  notes?: string
  enabled: boolean
}

export interface FiltersConfig {
  portals: Portal[]
  job_boards: Array<{
    type: 'indeed_rss' | 'glassdoor_rss'
    queries: string[]
    enabled: boolean
  }>
  title_filter?: {
    positive?: string[]
    negative?: string[]
  }
  location_blocklist?: string[]
  required_keywords?: string[]
}

// packages/core/src/ → packages/core/ → packages/ → monorepo root → config/
const CONFIG_ROOT = resolve(__dirname, '../../../config')

export function loadProfile(): ProfileConfig | null {
  const path = resolve(CONFIG_ROOT, 'profile.yml')
  if (!existsSync(path)) return null
  return yaml.load(readFileSync(path, 'utf-8')) as ProfileConfig
}

export function loadProfileVariant(variant: ProfileVariant): ProfileConfig | null {
  const profile = loadProfile()
  if (!profile) return null
  const variantBlock = profile.narrative?.variants?.[variant]
  if (!variantBlock) return profile
  return {
    ...profile,
    narrative: { ...profile.narrative, ...variantBlock },
  }
}

export function loadFilters(): FiltersConfig | null {
  const path = resolve(CONFIG_ROOT, 'filters.yml')
  if (!existsSync(path)) return null
  return yaml.load(readFileSync(path, 'utf-8')) as FiltersConfig
}

export function loadCv(variant?: ProfileVariant): string | null {
  if (variant) {
    const variantPath = resolve(CONFIG_ROOT, `cv-${variant}.md`)
    if (existsSync(variantPath)) return readFileSync(variantPath, 'utf-8')
  }
  const path = resolve(CONFIG_ROOT, 'cv.md')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function configExists(): { profile: boolean; filters: boolean; cv: boolean } {
  return {
    profile: existsSync(resolve(CONFIG_ROOT, 'profile.yml')),
    filters: existsSync(resolve(CONFIG_ROOT, 'filters.yml')),
    cv: existsSync(resolve(CONFIG_ROOT, 'cv.md')),
  }
}
