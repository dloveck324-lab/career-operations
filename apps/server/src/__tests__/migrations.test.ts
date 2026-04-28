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

  it('field_mappings retains UNIQUE(question_hash) until Step 5', () => {
    // Step 3 only adds the profile_variant column. Constraint change to
    // UNIQUE(question_hash, profile_variant) is deferred to Step 5 so it
    // can land with the query updates that depend on it.
    const db = new Database(':memory:')
    runMigrations(db)

    const insert = db.prepare(
      `INSERT INTO field_mappings (question_hash, question_text, answer) VALUES (?, ?, ?)`,
    )
    insert.run('h1', 'Q', 'first')
    expect(() => insert.run('h1', 'Q', 'duplicate')).toThrow(/UNIQUE/)
  })
})
