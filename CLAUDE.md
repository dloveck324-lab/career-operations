# Career Operations — Agent Instructions

## Project Summary

A local-first web dashboard for managing a job search pipeline. React+MUI frontend, Fastify+SQLite backend. Claude CLI drives job evaluation and form autofill. PinchTab controls the browser.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + MUI v6 + MUI DataGrid |
| Backend | Fastify 5 + better-sqlite3 |
| Browser | PinchTab daemon (HTTP, port 9867/9868) |
| AI | Claude CLI via `claude -p --dangerously-skip-permissions` |
| Data | SQLite at `data/jobs.db` |
| Config | YAML files in `config/` |

## Monorepo Layout

```
apps/server/src/
  index.ts              — Fastify entry, registers all routes
  db/schema.ts          — SQLite schema + type definitions
  db/queries.ts         — all DB read/write functions (single source of truth)
  routes/jobs.ts        — GET /api/jobs, PATCH /api/jobs/:id/status
  routes/scan.ts        — POST /api/scan, GET /api/scan/events (SSE)
  routes/evaluate.ts    — POST /api/evaluate, POST /api/evaluate/:id
  routes/settings.ts    — GET/PUT /api/settings/*, PATCH field-mappings/:id
  routes/apply.ts       — POST /api/apply/:id, SSE events, save-mappings
  scanner/runner.ts     — orchestrates all adapters, writes to DB
  scanner/adapters/     — greenhouse.ts, ashby.ts, lever.ts, indeed-rss.ts
  claude/evaluator.ts   — spawns `claude -p /job-evaluator`, parses JSON
  autofill/pinchtab.ts  — PinchTab HTTP client
  autofill/autofill.ts  — orchestrates autofill run: detects ATS, renders
                          mapping placeholders, spawns `claude /autofiller`,
                          parses structured JSON, emits suggestions event
  autofill/runs.ts      — per-run state + event stream (SSE source)
  import/wizard.ts      — one-shot config import from an existing folder

.claude/skills/
  job-evaluator/SKILL.md    — JSON-scoring skill invoked by evaluator
  autofiller/SKILL.md       — lean base skill (invoked by autofill)
  autofiller/ats/*.md       — per-ATS notes (greenhouse/lever/ashby/
                              workday/generic) inlined by hostname match
  autofiller/uploads.md     — pinchtab upload guidance (resume PDF)
  autofiller/dialogs.md     — native JS dialog detection/handling

apps/web/src/
  api.ts                — all fetch calls to the server (single import)
  theme.ts              — MUI dark theme (indigo primary)
  pages/PipelinePage    — Kanban tabs + DataGrid
  pages/SettingsPage    — Import / Profile / Filters / CV / Field Mappings
  components/AppShell   — topbar: SCAN, EVALUATE, SSE progress, health badges
  components/JobDetailDrawer — detail panel: autofill, mark applied, deep eval
  components/ScoreChip  — score badge (green ≥7.5, amber ≥5, red <5)

packages/core/src/
  prescreen.ts          — zero-token filter: blocklist, seniority, comp, location
  config.ts             — loadProfile(), loadFilters(), loadCv() from config/
```

## Job Status Machine

```
scanned → prescreened → evaluated → applied → interview → completed
                    ↓
                 skipped (any stage)
```

- `scanned` / `prescreened` — both live in the **Inbox** tab
- `evaluated` — **Evaluated** tab, sorted by score desc
- `applied` — **Applied** tab
- `interview` — **Interview** tab
- `completed` / `skipped` — **Closed** tab

**Rule: never skip the prescreen step.** All scanner output runs through `buildPrescreen()` before hitting the DB.

## Key Invariants

- **`db/queries.ts` is the only file that touches SQLite.** Routes call queries, never `db.prepare()` directly.
- **`api.ts` is the only file that calls `fetch`.** Components import from `api.ts`, never call fetch directly.
- **Claude CLI is the only LLM pathway.** No Anthropic SDK, no OpenAI. Spawn `claude -p ... --dangerously-skip-permissions`.
- **Evaluator and autofill are driven by skills, not inline prompts.** Evaluator invokes `/job-evaluator`. Autofill invokes `/autofiller` — `autofill.ts` only assembles the thin invocation (job, profile, rendered mappings, CV, ATS-specific notes, upload/dialog guidance).
- **PinchTab NEVER clicks Submit.** The `autofiller` skill explicitly stops before Submit; the user reviews in Chrome and submits manually.
- **Config files are the source of truth for user data.** `config/profile.yml`, `config/cv.md`, and optionally `config/cv.pdf` are read at run time, not cached in DB.
- **Mapping answers support placeholders.** `[[company_name]]`, `[[job_title]]`, `[[job_url]]` are rendered server-side before the agent sees them. `[[from_cv]]` / `[[from_jd]]` are left as directives for the agent to write an original answer grounded in the CV or JD.

## DB Tables (brief)

| Table | Purpose |
|---|---|
| `jobs` | One row per job posting. Deduped by `(source, external_id)`. |
| `jobs_content` | Separate table for raw/cleaned description (blob, kept out of `jobs` for query speed). |
| `evaluations` | One row per eval run. Tracks model + tokens. |
| `field_mappings` | Cached form field answers. `question_hash` = sha256(lowercase question). |
| `scan_runs` | One row per SCAN click. Tracks stats. |

## Token Budget

- **Prescreen**: 0 tokens (pure regex/keyword, `packages/core/prescreen.ts`)
- **Quick eval (default)**: Haiku 4.5. System prompt ~400 tokens (cached on 2nd job). Description truncated to 3000 chars (~750 tokens). Total ~500 tokens/job after caching.
- **Deep eval (on demand)**: Sonnet 4.6. Same budget, more nuanced verdict.
- **Autofill**: Haiku 4.5, only for fields NOT in `field_mappings` cache. One batch call per Apply click for all misses.
- Token gauge reads `evaluations` table (today's sum). CLI doesn't expose token counts; `prompt_tokens` / `completion_tokens` stored as 0 until we add a workaround.

## Adding a New Scanner Adapter

1. Create `apps/server/src/scanner/adapters/<name>.ts`
2. Export `async function scan<Name>(companyId, companyName): Promise<RawJob[]>`
3. `RawJob` interface is in `scanner/runner.ts`
4. Import and call it inside `runner.ts` → `runScan()` → `Promise.allSettled()`
5. Add portal type to `FiltersConfig` in `packages/core/src/config.ts` if needed

## Adding a New Route

1. Create `apps/server/src/routes/<name>.ts`
2. Export `async function <name>Routes(app: FastifyInstance)`
3. Register in `apps/server/src/index.ts` with prefix `/api`

## PinchTab Integration

PinchTab runs as a local daemon (`pinchtab daemon install`). Auth token auto-read from `~/.pinchtab/config.json`.

- Server URL: `http://127.0.0.1:9867` (management)
- Instance URL: `http://127.0.0.1:9868` (browser control)
- Default mode: **headless** (background). User can toggle per-apply via `showBrowser: true`.
- `pinchtab.ts` wraps all HTTP calls. Never call PinchTab endpoints directly from routes.

## Claude CLI Invocation Pattern

```ts
spawn('claude', [
  '-p', prompt,
  '--model', model,
  '--dangerously-skip-permissions',
  '--output-format', 'text',
])
```

- Always parse JSON from stdout with a `{...}` regex — CLI may add prose around it.
- On parse failure: retry once with a stricter system prompt.
- Binary path: detected via `which claude` at boot (surfaced in `/api/settings/status`).

## Config Files

All editable via the Settings UI. Created on first run or via Settings → Import.

| File | Created by | Purpose |
|---|---|---|
| `config/profile.yml` | Settings → Profile | Personal info, target roles, prescreen rules. Optional `cv_pdf_path` for a custom resume location |
| `config/filters.yml` | Settings → Filters | Portal list, title filter, job board queries |
| `config/cv.md` | Settings → CV | CV in markdown, injected into eval prompts |
| `config/cv.pdf` *(optional)* | User drop-in | Resume PDF uploaded by autofill to file inputs. Fallbacks: `config/resume.pdf`, `profile.cv_pdf_path`. If none present, resume fields go to `skipped` |
| `config/filters.example.yml` | Repo | Template — copy to `filters.yml` to get started |

**Never commit** `config/profile.yml`, `config/cv.md`, or `config/cv.pdf` — they contain personal data (.gitignore enforces this).

## Development

```bash
npm run dev          # starts both server (3001) and web (5173) concurrently
```

Server hot-reloads via `tsx watch`. Web hot-reloads via Vite HMR.

API proxy: Vite proxies `/api/*` → `http://127.0.0.1:3001` — no CORS issues in dev.

## Helping the User Run the Project

When the user reports startup or runtime issues, follow this checklist before touching code:

### System dependencies (check first)
1. **Node ≥ 20**: `node -v` — if lower, ask user to upgrade
2. **Claude CLI**: `which claude` — must return a path; if missing, direct to https://claude.ai/download
3. **PinchTab daemon**: `pinchtab daemon start` — if not installed, `pinchtab daemon install`

### Config files (check second)
- `config/profile.yml`, `config/filters.yml`, `config/cv.md` must exist
- If missing: Settings → Import, or manual entry in Settings UI
- The import wizard looks for a source folder; set `IMPORT_SOURCE=/path/to/folder` in the environment before starting the server
- Never create these files with placeholder content — they need real user data

### Port conflicts
- Server runs on **3001**, web on **5173**
- If a port is busy: `lsof -i :3001` or `lsof -i :5173` to find the conflicting process

### Health badges
- The topbar shows **PinchTab** and **Claude CLI** health badges
- Red badge = that service is unreachable; fix the service before debugging the app
- Badge status comes from `GET /api/settings/status`

### Common symptoms → root causes

| Symptom | Likely cause |
|---|---|
| Jobs not appearing after SCAN | No portals enabled in `config/filters.yml`, or file missing |
| Evaluate button does nothing | Claude CLI not found (`which claude` returns nothing) |
| Autofill opens blank tab | PinchTab daemon not running |
| Autofill skips resume upload | No `config/cv.pdf` / `config/resume.pdf` / `profile.cv_pdf_path` configured |
| Autofill run exits with `blocked: Authentication required` | ATS (Workday/LinkedIn/etc) requires sign-in. User must log in manually in Chrome, then retry Apply |
| Field mapping edits don't persist | Should auto-save on blur; check network tab for `PATCH /api/settings/field-mappings/:id` |
| Server crashes on boot | Port 3001 in use, or Node < 20 |
| Score shows "N/A" | Evaluation failed — check server logs for Claude CLI error |

### Utility script for DB issues
```bash
# Re-apply prescreen rules to all existing jobs (use after changing prescreen config)
node scripts/represcreen.mjs --dry-run   # preview changes
node scripts/represcreen.mjs             # apply
```

## Knowledge Base

| When you need to... | Read |
|---|---|
| Understand the full data flow (scan → eval → apply) | `docs/PIPELINE.md` |
| Add or debug a scanner adapter | `docs/SCANNERS.md` |
| Understand token costs or optimize prompts | `docs/TOKEN-BUDGET.md` |
| Work with PinchTab or autofill | `docs/PINCHTAB.md` |
| Understand config file schemas | `docs/CONFIG.md` |
| Look up table columns or write a raw SQL query | `docs/DB-SCHEMA.md` |
| Understand stack choices and conventions | `docs/STACK.md` |
| Help a user set up or troubleshoot | `docs/SETUP.md` |

**Lazy-load rule:** read only the doc that matches the current task. Never preload all docs.

## Lazy-Load Policy for Claude

**Read only what the active operation needs.** Never preload all config at boot.

| Operation | Read |
|---|---|
| Scan | `config/filters.yml` only |
| Prescreen | `config/profile.yml` → prescreen block only |
| Evaluate | `config/profile.yml` + `config/cv.md` |
| Autofill | `config/profile.yml` candidate block + `config/cv.md` (grounding for open-ended answers) + `config/cv.pdf` if present (uploaded to resume fields) + `.claude/skills/autofiller/ats/<detected>.md` by hostname + `.claude/skills/autofiller/{uploads,dialogs}.md` |

## Autofill Skill Flow (important for debugging)

1. User clicks Apply on a job. `apps/server/src/autofill/autofill.ts` creates a `Run` in `runs.ts`, opens a dedicated PinchTab tab, and navigates to the job's apply URL (rewritten by `toApplyUrl()` for Lever/Ashby/Workable).
2. `buildAgentPrompt()` assembles a thin `/autofiller` skill invocation: Job block, Candidate Profile JSON, rendered Known Mappings (placeholders substituted), CV text, and inlined `ats/<detected>.md` + `uploads.md` + `dialogs.md`.
3. Claude CLI is spawned with `--input-format stream-json --output-format stream-json`. stdout events feed `runRegistry.publish()` → SSE → `AutofillChatPanel`.
4. On close, `parseAgentResult()` extracts the strict JSON block. `suggestions` (fresh answers the agent generated, not from mappings/profile) are stored on the run and published as a `'suggestions'` event before `'done'`.
5. UI shows a review panel with editable answers + checkboxes. On "Save selected", `POST /api/apply/runs/:runId/save-mappings` inserts rows via `saveFieldMappingIfMissing` — closing the learning loop.

**Never bypass the skill.** If you need to change autofill behavior, edit `.claude/skills/autofiller/SKILL.md`, the relevant `ats/*.md`, or `uploads.md` / `dialogs.md`. Do NOT move logic into `autofill.ts` — the skill is the source of truth for agent behavior.

## Workflow Rules

These run on every meaningful feature, bugfix, or refactor. Claude does them proactively — never asks whether to commit, version-bump, or write tests.

### 1. Commits — Conventional Commits, one per delivery

Each delivery = one commit. Never bundle unrelated changes.

**Format:** `type(scope): summary` — under 72 chars on the subject line, body wrapped at ~72.

| Type | Use for |
|---|---|
| `feat` | New user-visible capability |
| `fix` | Bugfix |
| `refactor` | Internal restructure with no behavior change |
| `perf` | Measurable performance improvement |
| `test` | Adding or fixing tests only |
| `docs` | Docs / comments only |
| `chore` | Build, deps, tooling, config |
| `revert` | Reverts an earlier commit |

**Body should explain *why*, not what.** The diff already shows what. Reference the user-facing behavior, the regression being prevented, or the constraint being honored. Co-author trailer required:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

**Stage explicit paths** — `git add path/to/file.ts`, never `git add -A` or `git add .` (avoids accidentally committing `.env`, `config/profile.yml`, or stray local artifacts).

**Pushing requires explicit user approval.** Commit locally; let the user run `git push` (or ask for permission first). Never `--force-push`. Never `--no-verify`.

### 2. Version bumps — SemVer, in the root `package.json`

Bump on the same commit as the change:

| Bump | When |
|---|---|
| **major** (`N.0.0`) | Breaking change to a public API, route, DB schema, or config schema |
| **minor** (`x.N.0`) | New feature, new endpoint, new config knob, new UI surface |
| **patch** (`x.x.N`) | Bugfix, refactor, perf, docs, chore — anything backwards-compatible and invisible to consumers |

Pre-1.0 (current state): treat the **minor** as the de-facto major — bump it for any user-visible change, reserve patch for invisible work. Don't reset patch to 0 mid-stream just because you bumped minor in the same commit; let the file diff speak for itself.

### 3. Unit tests — write alongside new logic

When you add or change code with branchable behavior — new utility, new prescreen rule, new parser, new query — add a `*.test.ts` next to it under the existing `__tests__/` directories (`apps/server/src/__tests__/`, `packages/core/src/__tests__/`). Use Vitest (`npm run test`).

A unit test belongs when there is **logic worth pinning**: a pure function, a parser, a state machine, a query that filters/sorts. Skip tests for thin glue (`fetch → setState`, trivial passthroughs) — the cost-to-coverage ratio isn't there.

The test must fail without the change. Cover the happy path plus one edge case (empty input, malformed input, boundary value). Do NOT mock the database in queries tests — use a real in-memory SQLite (the existing tests already do this).

### 4. Functional tests — guard the cross-module flows

When you ship a feature that spans modules (route → query → SSE → UI; or scan → prescreen → eval), add an end-to-end test that exercises the whole path. These live alongside unit tests and use Vitest's `describe`/`it`.

Trigger checklist for a functional test:
- A new route was added or its contract changed.
- A new SSE event type was added.
- The job-status state machine gained a transition.
- The autofill skill or evaluator prompt changed shape.
- A migration changed a tracked column.

Run `npm run test` before committing. A red bar blocks the commit; fix the underlying cause, never `--no-verify`.

### 5. Personal data — never commit, never log

The following paths contain real-user PII and **must never appear in a commit, screenshot, log line, or test fixture**:

- `config/profile.yml` (real user) — only `config/profile.example.yml` is committed.
- `config/cv.md` (real user) — only `config/cv.example.md` is committed.
- `config/cv.pdf`, `config/resume.pdf`.
- `config/filters.yml` (user's target-company list — preference data) — only `config/filters.example.yml` is committed.
- `data/jobs.db` and its `-shm` / `-wal` siblings.
- Anything under `.env*` except `.env.example`.

**Before every `git add`:** if the path is in `config/` or `data/`, double-check it's not the real user's file. The `.gitignore` enforces this, but `git add -f` and `git commit -a` bypass it — never use those flags on these paths.

**In test fixtures, screenshots, and example output:** use the placeholder values from the `.example` files (`Your Name`, `you@example.com`, `linkedin.com/in/your-profile`). Never paste real names, emails, phone numbers, or company contacts.

**If you suspect a leak shipped:** stop, tell the user, and let them decide on remediation (history rewrite vs. rotate-and-move-on). Don't take destructive history actions unprompted.
