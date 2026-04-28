/**
 * One-time backfill: classify all jobs with industry_vertical = 'unclassified'.
 *
 * Step 3 of docs/DUAL_PROFILE_MIGRATION.md (open question #1: lean was CLI).
 *
 * Usage:
 *   npx tsx scripts/classify-existing-jobs.ts            # apply
 *   npx tsx scripts/classify-existing-jobs.ts --dry-run  # preview only
 *
 * Idempotent: only touches rows still tagged 'unclassified'. Safe to re-run.
 */
import Database from 'better-sqlite3'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { classifyVertical } from '@job-pipeline/core'
import { runMigrations } from '../apps/server/src/db/migrations.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data/jobs.db')
const DRY_RUN = process.argv.includes('--dry-run')

interface Row {
  id: number
  title: string
  company: string
  description: string | null
}

function main() {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  runMigrations(db)

  const rows = db
    .prepare(
      `SELECT j.id, j.title, j.company, jc.cleaned_md AS description
       FROM jobs j
       LEFT JOIN jobs_content jc ON jc.job_id = j.id
       WHERE j.industry_vertical = 'unclassified'`,
    )
    .all() as Row[]

  console.log(`Found ${rows.length} unclassified jobs`)
  if (rows.length === 0) return

  const tally = { healthcare: 0, generic: 0, ambiguous: 0 }
  const update = db.prepare('UPDATE jobs SET industry_vertical = ? WHERE id = ?')

  const apply = db.transaction((items: Row[]) => {
    for (const row of items) {
      const vertical = classifyVertical({
        title: row.title,
        description: row.description ?? '',
        company: row.company,
      })
      tally[vertical]++
      if (!DRY_RUN) update.run(vertical, row.id)
    }
  })
  apply(rows)

  const verb = DRY_RUN ? 'Would classify' : 'Classified'
  console.log(`${verb}: ${tally.healthcare} healthcare, ${tally.generic} generic, ${tally.ambiguous} ambiguous`)
  if (DRY_RUN) console.log('Dry run — no changes written. Re-run without --dry-run to apply.')

  db.close()
}

main()
