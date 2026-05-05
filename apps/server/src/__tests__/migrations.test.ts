import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations.js'

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name)
}

describe('runMigrations', () => {
  it('creates all tables and dual-profile columns on a fresh DB', () => {
    const db = new Database(':memory:')
    runMigrations(db)

    expect(columnNames(db, 'jobs')).toEqual(
      expect.arrayContaining(['industry_vertical', 'directional_score']),
    )
    expect(columnNames(db, 'evaluations')).toContain('profile_variant')
    expect(columnNames(db, 'field_mappings')).toContain('profile_variant')
  })

  it('adds eval-disposition columns on a fresh DB', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(columnNames(db, 'jobs')).toEqual(
      expect.arrayContaining(['eval_attempts', 'eval_last_error', 'eval_last_attempted_at', 'eval_last_error_kind']),
    )
    // eval_attempts defaults to 0 NOT NULL — verify by inserting a job and reading back.
    db.prepare(`
      INSERT INTO jobs (source, external_id, url, company, title)
      VALUES ('test', 'mig-1', 'http://x', 'Acme', 'Engineer')
    `).run()
    const row = db.prepare('SELECT eval_attempts, eval_last_error FROM jobs WHERE external_id = ?').get('mig-1') as { eval_attempts: number; eval_last_error: string | null }
    expect(row.eval_attempts).toBe(0)
    expect(row.eval_last_error).toBeNull()
  })

  it('is idempotent: running twice does not throw or duplicate columns', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    const jobsCols = columnNames(db, 'jobs')
    expect(jobsCols.filter((c) => c === 'industry_vertical')).toHaveLength(1)
    expect(jobsCols.filter((c) => c === 'directional_score')).toHaveLength(1)
  })

  it('migrates a pre-dual-profile DB without data loss', () => {
    const db = new Database(':memory:')

    // Simulate the OLD schema as it existed before Step 3.
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT NOT NULL,
        company TEXT NOT NULL, title TEXT NOT NULL,
        location TEXT, remote_policy TEXT, comp_text TEXT, description_hash TEXT,
        status TEXT NOT NULL DEFAULT 'scanned',
        archetype TEXT, score REAL, score_reason TEXT, skip_reason TEXT,
        scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
        evaluated_at TEXT, applied_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source, external_id)
      );
      CREATE TABLE evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL, model TEXT NOT NULL,
        prompt_tokens INTEGER, completion_tokens INTEGER,
        score REAL NOT NULL, verdict_md TEXT, raw_response TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_hash TEXT NOT NULL UNIQUE,
        question_text TEXT NOT NULL, answer TEXT NOT NULL,
        ats_type TEXT, confidence REAL NOT NULL DEFAULT 1.0,
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        use_count INTEGER NOT NULL DEFAULT 1
      );
    `)
    db.prepare(
      `INSERT INTO jobs (source, external_id, url, company, title) VALUES (?, ?, ?, ?, ?)`,
    ).run('greenhouse', 'pre-existing-1', 'https://x.com/1', 'Acme', 'Senior PM')
    db.prepare(
      `INSERT INTO field_mappings (question_hash, question_text, answer) VALUES (?, ?, ?)`,
    ).run('hash1', 'What is your name?', 'Dave')

    runMigrations(db)

    const job = db.prepare('SELECT * FROM jobs WHERE external_id = ?').get('pre-existing-1') as {
      industry_vertical: string
      directional_score: number | null
      title: string
    }
    expect(job.title).toBe('Senior PM')
    expect(job.industry_vertical).toBe('unclassified')
    expect(job.directional_score).toBeNull()

    const fm = db
      .prepare('SELECT question_hash, profile_variant, answer FROM field_mappings WHERE question_hash = ?')
      .get('hash1') as { profile_variant: string; answer: string }
    expect(fm.profile_variant).toBe('generic')
    expect(fm.answer).toBe('Dave')
  })

  it('adds skip_tags column on a fresh DB', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(columnNames(db, 'jobs')).toContain('skip_tags')
    // Verify nullable default by inserting and reading back
    db.prepare(`
      INSERT INTO jobs (source, external_id, url, company, title)
      VALUES ('test', 'skip-tags-1', 'http://x', 'Acme', 'Engineer')
    `).run()
    const row = db.prepare('SELECT skip_tags FROM jobs WHERE external_id = ?').get('skip-tags-1') as { skip_tags: string | null }
    expect(row.skip_tags).toBeNull()
  })

  it('field_mappings UNIQUE constraint partitions by (question_hash, profile_variant)', () => {
    const db = new Database(':memory:')
    runMigrations(db)

    const insert = db.prepare(
      `INSERT INTO field_mappings (question_hash, question_text, answer, profile_variant) VALUES (?, ?, ?, ?)`,
    )
    insert.run('h1', 'Q', 'generic-answer', 'generic')
    // Same hash, different variant — should succeed under partitioned UNIQUE.
    expect(() => insert.run('h1', 'Q', 'healthcare-answer', 'healthcare')).not.toThrow()
    // Same hash + same variant — should violate UNIQUE.
    expect(() => insert.run('h1', 'Q', 'duplicate', 'generic')).toThrow(/UNIQUE/)
  })

  it('preserves data when migrating field_mappings to partitioned UNIQUE', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_hash TEXT NOT NULL UNIQUE,
        question_text TEXT NOT NULL, answer TEXT NOT NULL,
        ats_type TEXT, confidence REAL NOT NULL DEFAULT 1.0,
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        use_count INTEGER NOT NULL DEFAULT 1
      );
    `)
    db.prepare(
      `INSERT INTO field_mappings (question_hash, question_text, answer, ats_type, use_count) VALUES (?, ?, ?, ?, ?)`,
    ).run('h-existing', 'Email', 'pre@example.com', 'profile', 7)

    runMigrations(db)

    const row = db
      .prepare('SELECT answer, profile_variant, use_count FROM field_mappings WHERE question_hash = ?')
      .get('h-existing') as { answer: string; profile_variant: string; use_count: number }
    expect(row.answer).toBe('pre@example.com')
    expect(row.profile_variant).toBe('generic')
    expect(row.use_count).toBe(7)
  })
})
