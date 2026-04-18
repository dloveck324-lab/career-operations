import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const DATA_DIR = resolve(process.cwd(), '../../data')
mkdirSync(DATA_DIR, { recursive: true })

export const db: DatabaseType = new Database(resolve(DATA_DIR, 'jobs.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,
    external_id     TEXT NOT NULL,
    url             TEXT NOT NULL,
    company         TEXT NOT NULL,
    title           TEXT NOT NULL,
    location        TEXT,
    remote_policy   TEXT,
    comp_text       TEXT,
    description_hash TEXT,
    status          TEXT NOT NULL DEFAULT 'scanned',
    archetype       TEXT,
    score           REAL,
    score_reason    TEXT,
    skip_reason     TEXT,
    scraped_at      TEXT NOT NULL DEFAULT (datetime('now')),
    evaluated_at    TEXT,
    applied_at      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, external_id)
  );

  CREATE TABLE IF NOT EXISTS jobs_content (
    job_id      INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    raw_text    TEXT,
    cleaned_md  TEXT
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    model             TEXT NOT NULL,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    score             REAL NOT NULL,
    verdict_md        TEXT,
    raw_response      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS field_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    question_hash   TEXT NOT NULL UNIQUE,
    question_text   TEXT NOT NULL,
    answer          TEXT NOT NULL,
    ats_type        TEXT,
    confidence      REAL NOT NULL DEFAULT 1.0,
    last_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
    use_count       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS scan_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT,
    found       INTEGER NOT NULL DEFAULT 0,
    added       INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'running'
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
  CREATE INDEX IF NOT EXISTS idx_evaluations_job ON evaluations(job_id);
  CREATE INDEX IF NOT EXISTS idx_field_mappings_hash ON field_mappings(question_hash);
`)

export type JobStatus =
  | 'scanned'
  | 'prescreened'
  | 'evaluated'
  | 'applied'
  | 'interview'
  | 'completed'
  | 'skipped'

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
}

export interface Evaluation {
  id: number
  job_id: number
  model: string
  prompt_tokens?: number
  completion_tokens?: number
  score: number
  verdict_md?: string
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
