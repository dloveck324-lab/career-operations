# Job Pipeline — Agent Instructions

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
  routes/settings.ts    — GET/PUT /api/settings/*, health checks
  routes/apply.ts       — POST /api/apply/:id
  scanner/runner.ts     — orchestrates all adapters, writes to DB
  scanner/adapters/     — greenhouse.ts, ashby.ts, lever.ts, indeed-rss.ts
  claude/evaluator.ts   — spawns claude -p, parses JSON eval response
  autofill/pinchtab.ts  — PinchTab HTTP client
  autofill/autofill.ts  — form fill flow: cache lookup → Claude → PinchTab fill
  import/wizard.ts      — one-shot import from Dave's job search/

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
- **PinchTab NEVER clicks Submit.** `autofill.ts` stops at the submit button and calls `showBrowser()` so the user reviews first.
- **Config files are the source of truth for user data.** `config/profile.yml` and `config/cv.md` are read at evaluation time, not cached in DB.

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

Auto-imported from `Dave's job search/` on first boot if missing. All editable via Settings UI.

| File | Created by | Purpose |
|---|---|---|
| `config/profile.yml` | Auto-import / Settings → Profile | Personal info, target roles, prescreen rules |
| `config/filters.yml` | Auto-import / Settings → Filters | Portal list, title filter, job board queries |
| `config/cv.md` | Auto-import / Settings → CV | CV in markdown, injected into eval prompts |
| `config/filters.example.yml` | Repo | Fallback template if auto-import has no source |

**Never commit** `config/profile.yml` or `config/cv.md` — they contain personal data (.gitignore enforces this).

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
3. **PinchTab daemon**: `pinchtab daemon status` — if not running, `pinchtab daemon start`; if not installed, `pinchtab daemon install`

### Config files (check second)
- `config/profile.yml`, `config/filters.yml`, `config/cv.md` must exist
- If missing: Settings → Import → "Import from Dave's job search", or manual entry in Settings UI
- The import wizard looks for a sibling folder named `Dave's job search/` relative to this project; if it's elsewhere, user can set `IMPORT_SOURCE=/path/to/folder` in the environment before starting the server
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
| Autofill | `config/profile.yml` candidate block + `config/cv.md` (for miss fields only) |

## Commit & Version Bump — Regra Obrigatória

**Ao concluir qualquer feature, bugfix ou refactor de relevância, Claude DEVE proativamente:**

1. **Version bump** no `package.json` raiz:
   - patch (`x.x.N`) para bugfix/refactor/change
   - minor (`x.N.0`) para feature nova
   - major (`N.0.0`) apenas se quebrar API existente
2. **Commit** com todas as mudanças relevantes:
   ```
   git add <arquivos modificados>
   git commit -m "tipo: descrição concisa\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```
3. **Branch alvo:** `dave-app` (remote: `origin` → `dloveck324-lab/career-ops`)
4. **Push automático** para `origin/dave-app` após o commit.

**Nunca perguntar se deve commitar** — fazê-lo automaticamente ao término de cada feature/fix. Nunca agrupar múltiplas features no mesmo commit. Cada entrega = um commit.
