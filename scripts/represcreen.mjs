/**
 * Re-applies the prescreen location filter to all jobs currently in 'prescreened' status.
 * Run once after adding the require_us_or_remote filter to catch existing Inbox jobs.
 *
 * Usage: node scripts/represcreen.mjs [--dry-run]
 */
import Database from 'better-sqlite3'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../data/jobs.db')
const DRY_RUN = process.argv.includes('--dry-run')

const NON_US_TERMS = [
  'uk', 'united kingdom', 'england', 'britain',
  'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium',
  'sweden', 'denmark', 'norway', 'finland', 'switzerland', 'austria',
  'ireland', 'poland', 'portugal', 'czechia', 'czech republic', 'hungary',
  'romania', 'greece', 'croatia', 'slovakia',
  'canada', 'australia', 'new zealand', 'india', 'brazil', 'mexico',
  'singapore', 'japan', 'china', 'south korea', 'korea', 'taiwan',
  'israel', 'turkey', 'ukraine', 'russia',
  'south africa', 'nigeria', 'kenya', 'egypt',
  'argentina', 'colombia', 'chile', 'peru',
  'emea', 'apac', 'latam', 'europe', 'european union',
  'london', 'berlin', 'paris', 'amsterdam', 'toronto', 'vancouver', 'montreal',
  'sydney', 'melbourne', 'dublin', 'zurich', 'stockholm', 'copenhagen',
  'oslo', 'helsinki', 'vienna', 'warsaw', 'lisbon', 'madrid', 'barcelona',
  'rome', 'milan', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'pune',
  'tel aviv', 'tokyo', 'seoul', 'beijing', 'shanghai',
]

const REMOTE_SIGNALS = ['remote', 'distributed', 'work from home', 'wfh', 'anywhere']

function isRemoteLocation(location) {
  return REMOTE_SIGNALS.some(s => (location ?? '').toLowerCase().includes(s))
}

function isNonUS(location) {
  if (!location) return false
  const lower = location.toLowerCase()
  return NON_US_TERMS.some(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[\\s,/(])${escaped}(?:$|[\\s,/)])`).test(lower)
  })
}

const db = new Database(DB_PATH, { readonly: DRY_RUN })

const jobs = db.prepare(`
  SELECT j.id, j.title, j.location, j.company, jc.cleaned_md as description
  FROM jobs j
  LEFT JOIN jobs_content jc ON jc.job_id = j.id
  WHERE j.status = 'prescreened'
`).all()

console.log(`Found ${jobs.length} prescreened jobs to check...\n`)

const toSkip = jobs.filter(j => !isRemoteLocation(j.location) && isNonUS(j.location))

if (toSkip.length === 0) {
  console.log('No non-US jobs found in Inbox. Nothing to do.')
  process.exit(0)
}

console.log(`${DRY_RUN ? '[DRY RUN] Would skip' : 'Skipping'} ${toSkip.length} non-US jobs:\n`)
for (const j of toSkip) {
  console.log(`  [${j.id}] ${j.company} — ${j.title} (${j.location ?? 'no location'})`)
}

if (!DRY_RUN) {
  const update = db.prepare(`
    UPDATE jobs SET status = 'skipped', skip_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `)
  const run = db.transaction(() => {
    for (const j of toSkip) {
      update.run(`non-US location "${j.location}" and not remote`, j.id)
    }
  })
  run()
  console.log(`\nDone. ${toSkip.length} jobs moved to Skipped.`)
} else {
  console.log('\n(run without --dry-run to apply)')
}
