import type { Database as DatabaseType } from 'better-sqlite3'

/**
 * Apply schema + migrations to a database connection. Idempotent — safe to
 * run on every boot. No module-level side effects so CLI scripts can import
 * this without opening the server's singleton DB.
 */
export function runMigrations(db: DatabaseType): void {
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

  // ── Dual-profile migration (Step 3 of docs/DUAL_PROFILE_MIGRATION.md) ──
  const hasColumn = (table: string, column: string): boolean => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.some((r) => r.name === column)
  }

  if (!hasColumn('jobs', 'industry_vertical')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN industry_vertical TEXT NOT NULL DEFAULT 'unclassified'`)
  }
  if (!hasColumn('jobs', 'directional_score')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN directional_score INTEGER`)
  }
  if (!hasColumn('evaluations', 'profile_variant')) {
    db.exec(`ALTER TABLE evaluations ADD COLUMN profile_variant TEXT NOT NULL DEFAULT 'generic'`)
  }

  // Step 3 only adds the column. The UNIQUE(question_hash) → UNIQUE(question_hash,
  // profile_variant) constraint change is deferred to Step 5, which will pair
  // the table rebuild with the query updates that depend on it. Keeping the
  // existing constraint here keeps Step 3 non-breaking for current callers.
  if (!hasColumn('field_mappings', 'profile_variant')) {
    db.exec(`ALTER TABLE field_mappings ADD COLUMN profile_variant TEXT NOT NULL DEFAULT 'generic'`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_field_mappings_variant ON field_mappings(profile_variant)`)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_industry ON jobs(industry_vertical)`)
}
