import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import { runMigrations } from './migrations.js'

const DATA_DIR = resolve(process.cwd(), '../../data')
mkdirSync(DATA_DIR, { recursive: true })

export const db: DatabaseType = new Database(resolve(DATA_DIR, 'jobs.db'))

runMigrations(db)

export { runMigrations }

export type JobStatus =
  | 'scanned'
  | 'prescreened'
  | 'evaluated'
  | 'ready_to_submit'
  | 'applied'
  | 'interview'
  | 'completed'
  | 'skipped'

export type IndustryVerticalDb = 'healthcare' | 'generic' | 'ambiguous' | 'unclassified'
export type ProfileVariantDb = 'healthcare' | 'generic'

export interface Job {
  id: number
  source: string
  external_id: string
  url: string
  company: string
  title: string
  location?: string
  remote_policy?: string
  comp_text?: string
  description_hash?: string
  status: JobStatus
  archetype?: string
  score?: number
  score_reason?: string
  skip_reason?: string
  scraped_at: string
  evaluated_at?: string
  applied_at?: string
  updated_at: string
  industry_vertical?: IndustryVerticalDb
  directional_score?: number
  eval_attempts?: number
  eval_last_error?: string
  eval_last_attempted_at?: string
  eval_last_error_kind?: EvalErrorKind
  /** JSON string: {"category":"language_requirement","keywords":["french"]} */
  skip_tags?: string
}

export type EvalErrorKind = 'credits' | 'rate_limit' | 'parse' | 'auth' | 'other'

export interface Evaluation {
  id: number
  job_id: number
  model: string
  prompt_tokens?: number
  completion_tokens?: number
  score: number
  verdict_md?: string
  created_at: string
  profile_variant: ProfileVariantDb
  /** JSON-serialized string[] — green_flags from the eval JSON output */
  green_flags_json?: string
  /** JSON-serialized string[] — red_flags from the eval JSON output */
  red_flags_json?: string
}

export type EvalFeedbackFlagType = 'red' | 'green' | 'verdict' | 'score'

export interface EvalFeedback {
  id: number
  evaluation_id: number
  job_id: number
  flag_type: EvalFeedbackFlagType
  flag_text: string
  correction?: string
  created_at: string
}

export interface FieldMapping {
  id: number
  question_hash: string
  question_text: string
  answer: string
  ats_type?: string
  confidence: number
  last_used_at: string
  use_count: number
  profile_variant: ProfileVariantDb
}

export interface ScanRun {
  id: number
  started_at: string
  ended_at?: string
  found: number
  added: number
  skipped: number
  cost_tokens: number
  status: 'running' | 'done' | 'failed'
}
