# Database Schema

File: `data/jobs.db` (SQLite, WAL mode)

## jobs

Primary table. One row per unique job posting.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `source` | TEXT | `greenhouse` / `ashby` / `lever` / `indeed_rss` |
| `external_id` | TEXT | ATS-native ID. UNIQUE with `source`. |
| `url` | TEXT | Job posting URL |
| `company` | TEXT | Display name |
| `title` | TEXT | Role title |
| `location` | TEXT | Location string from ATS |
| `remote_policy` | TEXT | `remote` or null |
| `comp_text` | TEXT | Compensation range, raw string |
| `description_hash` | TEXT | sha256 of description for dedup (first 16 chars) |
| `status` | TEXT | See status machine in PIPELINE.md |
| `archetype` | TEXT | Best-match archetype slug |
| `score` | REAL | 0–10, one decimal. Null until evaluated. |
| `score_reason` | TEXT | First 500 chars of verdict_md |
| `skip_reason` | TEXT | Prescreen failure reason |
| `scraped_at` | TEXT | ISO datetime |
| `evaluated_at` | TEXT | ISO datetime |
| `applied_at` | TEXT | ISO datetime |
| `updated_at` | TEXT | ISO datetime, updated on every status change |

Indexes: `status`, `score DESC`, `company`

## jobs_content

Separate table to keep `jobs` rows thin for fast queries.

| Column | Type | Notes |
|---|---|---|
| `job_id` | INTEGER PK | FK → jobs.id CASCADE DELETE |
| `raw_text` | TEXT | HTML-stripped text from scanner |
| `cleaned_md` | TEXT | Future: markdown-cleaned version |

## evaluations

One row per evaluation run (allows history tracking).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `job_id` | INTEGER | FK → jobs.id CASCADE DELETE |
| `model` | TEXT | `claude-haiku-4-5-20251001` or `claude-sonnet-4-6` |
| `prompt_tokens` | INTEGER | 0 (CLI doesn't expose counts yet) |
| `completion_tokens` | INTEGER | 0 |
| `score` | REAL | |
| `verdict_md` | TEXT | Formatted verdict + flags |
| `raw_response` | TEXT | First 2000 chars of CLI stdout |
| `created_at` | TEXT | ISO datetime |

## field_mappings

Growing cache of form field answers.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `question_hash` | TEXT UNIQUE | sha256(lowercase trim question) first 16 chars |
| `question_text` | TEXT | Original question label/placeholder |
| `answer` | TEXT | Cached answer |
| `ats_type` | TEXT | `greenhouse` / `ashby` / `lever` / `workday` / `custom` |
| `confidence` | REAL | 1.0 default. Future: allow user to rate. |
| `last_used_at` | TEXT | Updated on every cache hit |
| `use_count` | INTEGER | Incremented on every cache hit |

## scan_runs

One row per SCAN button click.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `started_at` | TEXT | |
| `ended_at` | TEXT | Null while running |
| `found` | INTEGER | Total jobs found across all adapters |
| `added` | INTEGER | New jobs inserted (not deduped) |
| `skipped` | INTEGER | Jobs that failed prescreen |
| `cost_tokens` | INTEGER | 0 (scan has no LLM cost) |
| `status` | TEXT | `running` / `done` / `failed` |

## Querying

All queries go through `apps/server/src/db/queries.ts`. Never write `db.prepare()` directly in routes or services.

Useful manual queries for debugging:
```sql
-- Count by status
SELECT status, COUNT(*) FROM jobs GROUP BY status;

-- Top scored jobs
SELECT company, title, score, archetype FROM jobs WHERE status = 'evaluated' ORDER BY score DESC LIMIT 20;

-- Field mappings by ATS
SELECT ats_type, COUNT(*) FROM field_mappings GROUP BY ats_type;

-- Recent scan runs
SELECT * FROM scan_runs ORDER BY id DESC LIMIT 5;
```
