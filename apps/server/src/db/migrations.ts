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

  // Eval-disposition migration (see docs/PIPELINE.md and the eval-disposition
  // PR). Tracks how many times the evaluator has tried a job, the last error
  // message, when it last attempted, and the classified kind of error so the
  // UI can show a credit-low banner vs a generic eval failure.
  if (!hasColumn('jobs', 'eval_attempts')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN eval_attempts INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasColumn('jobs', 'eval_last_error')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN eval_last_error TEXT`)
  }
  if (!hasColumn('jobs', 'eval_last_attempted_at')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN eval_last_attempted_at TEXT`)
  }
  if (!hasColumn('jobs', 'eval_last_error_kind')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN eval_last_error_kind TEXT`)
  }
  if (!hasColumn('evaluations', 'profile_variant')) {
    db.exec(`ALTER TABLE evaluations ADD COLUMN profile_variant TEXT NOT NULL DEFAULT 'generic'`)
  }

  // Skip-tagging migration. Stores a JSON object {"category","keywords"} so
  // the UI can aggregate recurring skip patterns and suggest blocklist entries.
  if (!hasColumn('jobs', 'skip_tags')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN skip_tags TEXT`)
  }

  // Step 3: add profile_variant column to field_mappings (idempotent).
  if (!hasColumn('field_mappings', 'profile_variant')) {
    db.exec(`ALTER TABLE field_mappings ADD COLUMN profile_variant TEXT NOT NULL DEFAULT 'generic'`)
  }

  // Step 5: partition the UNIQUE constraint on (question_hash, profile_variant).
  // SQLite can't drop a column-level UNIQUE in place, so rebuild the table.
  // Detection: the new constraint pattern in sqlite_master.sql is unique to
  // the post-Step-5 schema, so its absence means we still need to migrate.
  const fmSql = (db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='field_mappings'`)
    .get() as { sql?: string } | undefined)?.sql ?? ''
  if (!fmSql.includes('UNIQUE(question_hash, profile_variant)')) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE field_mappings_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        question_hash   TEXT NOT NULL,
        question_text   TEXT NOT NULL,
        answer          TEXT NOT NULL,
        ats_type        TEXT,
        confidence      REAL NOT NULL DEFAULT 1.0,
        last_used_at    TEXT NOT NULL DEFAULT (datetime('now')),
        use_count       INTEGER NOT NULL DEFAULT 1,
        profile_variant TEXT NOT NULL DEFAULT 'generic',
        UNIQUE(question_hash, profile_variant)
      );
      INSERT INTO field_mappings_new
        (id, question_hash, question_text, answer, ats_type, confidence, last_used_at, use_count, profile_variant)
      SELECT id, question_hash, question_text, answer, ats_type, confidence, last_used_at, use_count, profile_variant
      FROM field_mappings;
      DROP TABLE field_mappings;
      ALTER TABLE field_mappings_new RENAME TO field_mappings;
      CREATE INDEX idx_field_mappings_hash ON field_mappings(question_hash);
      CREATE INDEX idx_field_mappings_variant ON field_mappings(profile_variant);
      COMMIT;
    `)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_industry ON jobs(industry_vertical)`)
}
