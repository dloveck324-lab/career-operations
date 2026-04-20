import { existsSync, readFileSync, copyFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import { saveFieldMapping } from '../db/queries.js'

// process.cwd() = apps/server/ → ../../../ = parent of this project → sibling "Dave's job search"
const SOURCE = process.env.IMPORT_SOURCE
  ? resolve(process.env.IMPORT_SOURCE)
  : resolve(process.cwd(), "../../../Dave's job search")
const CONFIG_DIR = resolve(process.cwd(), '../../config')

export interface ImportResult {
  profile: boolean
  cv: boolean
  filters: boolean
  fieldMappings: number
  warnings: string[]
}

export function runImportWizard(): ImportResult {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const result: ImportResult = { profile: false, cv: false, filters: false, fieldMappings: 0, warnings: [] }

  // profile.yml — copy as-is if missing
  const srcProfile = resolve(SOURCE, 'config', 'profile.yml')
  const dstProfile = resolve(CONFIG_DIR, 'profile.yml')
  if (existsSync(srcProfile) && !existsSync(dstProfile)) {
    copyFileSync(srcProfile, dstProfile)
    result.profile = true
  }

  // cv.md
  const srcCv = resolve(SOURCE, 'cv.md')
  const dstCv = resolve(CONFIG_DIR, 'cv.md')
  if (existsSync(srcCv) && !existsSync(dstCv)) {
    copyFileSync(srcCv, dstCv)
    result.cv = true
  }

  // filters.yml — build from portals.yml
  const dstFilters = resolve(CONFIG_DIR, 'filters.yml')
  if (!existsSync(dstFilters)) {
    const portalsPath = resolve(SOURCE, 'portals.yml')
    if (existsSync(portalsPath)) {
      try {
        const raw = yaml.load(readFileSync(portalsPath, 'utf-8')) as DavePortalsYml
        const filtersObj = convertDavePortals(raw)
        writeFileSync(dstFilters, yaml.dump(filtersObj, { lineWidth: 120 }))
        result.filters = true
      } catch (e) {
        result.warnings.push(`Could not parse portals.yml: ${e}`)
        // Write empty filters so the app doesn't break
        writeFileSync(dstFilters, yaml.dump({ portals: [], job_boards: [], title_filter: { positive: [], negative: [] } }))
      }
    } else {
      // No source portals — write empty template
      writeFileSync(dstFilters, yaml.dump({ portals: [], job_boards: [], title_filter: { positive: [], negative: [] } }))
    }
  }

  // field-mappings.yml → DB
  const srcMappings = resolve(SOURCE, 'config', 'field-mappings.yml')
  if (existsSync(srcMappings)) {
    try {
      const raw = yaml.load(readFileSync(srcMappings, 'utf-8')) as Record<string, unknown>
      result.fieldMappings = importFieldMappings(raw)
    } catch (e) {
      result.warnings.push(`Could not import field-mappings.yml: ${e}`)
    }
  }

  return result
}

// ── Dave portals.yml shape ────────────────────────────────────────────────────

interface DaveCompany {
  name: string
  careers_url?: string
  api?: string
  enabled?: boolean
  notes?: string
  scan_method?: string
}

interface DavePortalsYml {
  title_filter?: { positive?: string[]; negative?: string[] }
  tracked_companies?: DaveCompany[]
  search_queries?: Array<{ query?: string; site?: string }>
}

function convertDavePortals(dave: DavePortalsYml): object {
  const portals: object[] = []

  for (const c of dave.tracked_companies ?? []) {
    if (!c.name) continue
    const { type, company_id } = detectAts(c.api, c.careers_url)
    portals.push({
      name: c.name,
      type,
      company_id: company_id ?? '',
      url: c.careers_url ?? '',
      notes: c.notes ?? '',
      enabled: c.enabled !== false,
    })
  }

  // Extract Indeed-style search queries from search_queries block
  const rssQueries: string[] = []
  for (const q of dave.search_queries ?? []) {
    if (q.query) rssQueries.push(q.query)
  }

  return {
    portals,
    job_boards: rssQueries.length > 0
      ? [{ type: 'indeed_rss', queries: rssQueries, enabled: true }]
      : [],
    title_filter: {
      positive: dave.title_filter?.positive ?? [],
      negative: dave.title_filter?.negative ?? [],
    },
  }
}

function detectAts(apiUrl?: string, careersUrl?: string): { type: string; company_id: string } {
  const url = apiUrl ?? careersUrl ?? ''

  const ghMatch = url.match(/greenhouse\.io\/v1\/boards\/([^/]+)/)
  if (ghMatch) return { type: 'greenhouse', company_id: ghMatch[1] }

  const ghBoardMatch = url.match(/greenhouse\.io\/([^/\s?]+)/)
  if (ghBoardMatch) return { type: 'greenhouse', company_id: ghBoardMatch[1] }

  const ashbyMatch = url.match(/ashbyhq\.com\/(?:posting-api\/job-board\/)?([^/\s?]+)/)
  if (ashbyMatch) return { type: 'ashby', company_id: ashbyMatch[1] }

  const leverMatch = url.match(/lever\.co\/v0\/postings\/([^/\s?]+)/)
  if (leverMatch) return { type: 'lever', company_id: leverMatch[1] }

  if (url.includes('lever.co')) {
    const slugMatch = careersUrl?.match(/jobs\.lever\.co\/([^/\s?]+)/)
    if (slugMatch) return { type: 'lever', company_id: slugMatch[1] }
  }

  if (url.includes('workday')) return { type: 'workday', company_id: '' }

  return { type: 'custom', company_id: '' }
}

function importFieldMappings(raw: Record<string, unknown>): number {
  let count = 0
  for (const [atsType, fields] of Object.entries(raw)) {
    if (!Array.isArray(fields)) continue
    for (const field of fields as Array<{ question?: string; answer?: string; label?: string; value?: string }>) {
      const question = field.question ?? field.label
      const answer = field.answer ?? field.value
      if (question && answer) {
        saveFieldMapping(question, String(answer), atsType)
        count++
      }
    }
  }
  return count
}
