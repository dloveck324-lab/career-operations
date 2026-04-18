# Pipeline — How Data Flows

## Full flow from SCAN to Applied

```
[User clicks SCAN]
      │
      ▼
POST /api/scan
  → startScanRun() → inserts scan_runs row
  → returns { runId } immediately
  → fires runScan() in background

runScan() (scanner/runner.ts)
  → loads config/filters.yml + config/profile.yml
  → builds prescreenFn from profile.prescreen block
  → spawns all API adapters in parallel (Promise.allSettled)
    ├─ scanGreenhouse(companyId, name) → RawJob[]
    ├─ scanAshby(companyId, name)      → RawJob[]
    ├─ scanLever(companyId, name)      → RawJob[]
    └─ scanIndeedRss(query)            → RawJob[]
  → for each RawJob:
      1. prescreenFn(offer) → { pass, reason, archetype }
      2. upsertJob()  →  status: 'prescreened' | 'skipped'
      3. upsertJobContent() if description present
      4. emit SSE progress event → UI counter updates live
  → updateScanRun(stats)
  → emit SSE 'done' event → UI dispatches 'jobs-updated' → DataGrid refreshes

[Evaluate runs automatically after scan OR user clicks EVALUATE]
      │
      ▼
POST /api/evaluate
  → getJobs('prescreened') → array
  → for each job in sequence:
      1. getJobContent(id) → cleaned_md or raw_text
      2. evaluateJob(job, description) (claude/evaluator.ts)
         → buildSystemPrompt(profile, cv) — reads config/ files at call time
         → buildUserPrompt(job, description) — truncates to 3000 chars
         → spawn('claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', ...])
         → parse JSON from stdout
         → return { score, archetype, verdict_md, ... }
      3. saveEvaluation()
      4. updateJobStatus(id, 'evaluated', { score, archetype, ... })
      5. emit SSE eval_done event

[User opens a job in the drawer and clicks "Auto-fill (background)"]
      │
      ▼
POST /api/apply/:id  { showBrowser: false }
  → startAutofill(job, { headless: true }) (autofill/autofill.ts)
  → PinchTabClient.isReachable()
  → client.startInstance('headless')
  → client.navigate(job.url)
  → client.snap() → elements[]
  → for each input/textarea/select:
      hash(label) → lookupFieldMapping()
        HIT  → client.fill(ref, cached)   [0 tokens]
        MISS → collect into missing[]
  → if missing.length > 0:
      askClaudeForFields(job, questions)  [one Haiku call]
      → saveFieldMapping() for each answer
      → client.fill() for each
  → client.showBrowser()  ← user sees filled form, reviews, clicks Submit manually
  → return { filled, unfilled, cached, message }

[User clicks "Mark Applied" in the drawer]
      │
      ▼
PATCH /api/jobs/:id/status  { status: 'applied' }
  → updateJobStatus(id, 'applied', { applied_at })
  → UI dispatches 'jobs-updated' → row moves to Applied tab
```

## Prescreen Logic (zero tokens)

`packages/core/src/prescreen.ts` — pure function, no I/O.

Checks in order (first fail wins):
1. **Blocklist titles** — `config/profile.yml → prescreen.blocklist_titles`
2. **Seniority minimum** — title keyword detection + ladder rank comparison
3. **Comp floor** — regex extracts salary from description/title, compares to floor
4. **Location policy** — on-site check vs `allow_onsite_cities`, remote detection

Returns `{ pass: boolean, reason: string | null, archetype: string | null }`.
`archetype` is tagged even on pass — used to pre-label the job before LLM eval.

## Status Transitions

| From | To | Trigger |
|---|---|---|
| (new) | `scanned` / `prescreened` / `skipped` | Scanner run |
| `prescreened` | `evaluated` | Evaluate run |
| `prescreened` | `skipped` | User skips |
| `evaluated` | `applied` | User marks applied |
| `evaluated` | `skipped` | User skips |
| `applied` | `interview` | User updates status |
| `interview` | `completed` | User updates status |
| any | `skipped` | User skips |

## Deduplication

Jobs are deduplicated by `(source, external_id)` — DB UNIQUE constraint.
`upsertJob()` does `SELECT id` first; if row exists, returns `{ inserted: false, id }` — no update, no duplicate.
The scanner counts only `inserted: true` rows as "added".
