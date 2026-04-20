import Database from 'better-sqlite3'

export const db = new Database(':memory:')

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
`)
