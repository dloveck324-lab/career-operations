# Token Budget & Optimization

## Layer 0 — Source filters (0 tokens)
Scanner adapters only fetch from portals/queries listed in `config/filters.yml`.
Disabling a portal → zero requests, zero tokens, zero rows added.

## Layer 1 — Prescreen (0 tokens)
`packages/core/src/prescreen.ts` filters raw jobs before any DB write.
Hard filters: seniority floor, comp floor, title blocklist, location policy.
Failed jobs → `status: skipped` with `skip_reason`. Never evaluated.

## Layer 2 — Dedup (0 tokens)
`upsertJob()` checks `(source, external_id)` UNIQUE constraint.
Jobs already in the DB from previous scans are silently skipped.

## Layer 3 — Quick eval (Haiku 4.5, ~300–500 tokens/job after cache)

System prompt breakdown (sent once, cached on 2+ jobs in sequence):
- Profile header + archetypes: ~150 tokens
- CV excerpt (2000 chars): ~500 tokens
- Output schema: ~80 tokens
- **Total system: ~730 tokens** → amortized to ~0 from job 2 onward in a batch

User prompt per job:
- Job metadata (title, company, location, comp): ~50 tokens
- Description (truncated at 3000 chars ≈ 750 tokens): ~750 tokens
- **Total user: ~800 tokens**

Response (JSON):
- Score + archetype + verdict + flags: ~150 tokens

**Effective cost per job: ~950 tokens uncached / ~150 tokens cached (jobs 2+)**

## Layer 4 — Deep eval (Sonnet 4.6, on-demand only)
Same prompt structure as quick eval. Called only when user clicks "Deep Eval" on a specific job.
Never runs automatically. Costs ~3–5× more than Haiku — reserve for shortlisted roles.

## Layer 5 — Autofill (Haiku 4.5, miss fields only)
`field_mappings` table caches answers by `hash(question_text)`.
First application to a given ATS type: all fields → one Haiku batch call.
Second+ application to same ATS: cache hit rate ~80–100% → near-zero tokens.

Estimated cost per application:
- First Greenhouse app: ~600 tokens (10–15 fields)
- Second+ Greenhouse app: ~0 tokens

## Token Gauge
`GET /api/health` returns `tokens.total` = today's sum from `evaluations` table.
Displayed in the AppShell topbar.

**Limitation:** `claude -p` CLI doesn't expose token counts in its output.
`prompt_tokens` and `completion_tokens` are stored as `0` in the DB.
To get real counts: switch to Anthropic SDK (requires API key) or parse `--output-format json` if Claude CLI supports it in a future version.

## Budget Estimates (per scan session)

| Scenario | New jobs | Tokens (approx) |
|---|---|---|
| 50 new, 30 pass prescreen | 30 | ~8k (20k uncached) |
| 100 new, 60 pass | 60 | ~15k |
| 0 new (dedup) | 0 | 0 |
| 5 deep evals | 5 | ~15–25k |
| 10 applications (cold) | 10 | ~6k |
| 10 applications (warm) | 10 | ~0 |
