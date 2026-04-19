# Job Pipeline

A local-first web dashboard for managing a job search pipeline. Scan job boards, auto-evaluate candidates with Claude AI, and autofill application forms via browser automation.

## Prerequisites

| Requirement | Check | Install |
|---|---|---|
| Node.js ≥ 20 | `node -v` | [nodejs.org](https://nodejs.org) |
| Claude CLI | `which claude` | [claude.ai/download](https://claude.ai/download) |
| PinchTab daemon | `pinchtab --version` | `curl -fsSL https://pinchtab.com/install.sh \| bash` |

## Installation

```bash
# Clone the repo
git clone <repo-url>
cd "Dave Search Job App"

# Install all workspace dependencies
npm install
```

## First Run

### 1. Start the dev servers

```bash
npm run dev
```

This starts two processes concurrently:
- **Backend** (Fastify): `http://127.0.0.1:3001`
- **Frontend** (Vite): `http://localhost:5173`

The SQLite database (`data/jobs.db`) is created automatically on first boot.

### 2. Install the PinchTab daemon

PinchTab controls the browser for form autofill. Run once:

```bash
pinchtab daemon install
```

### 3. Configure your profile

Open `http://localhost:5173` and go to **Settings**.

You have two options:

**Option A — Auto-import** (if you have a `Dave's job search/` folder next to this project):
- Go to **Settings → Import** and click **Import from Dave's job search**
- This populates `config/profile.yml`, `config/filters.yml`, and `config/cv.md` automatically

**Option B — Manual setup**:
- **Settings → Profile**: fill in your name, target roles, location, and compensation range
- **Settings → CV**: paste your CV in Markdown format
- **Settings → Filters**: configure which job portals to scan and search keywords

### 4. Verify the health indicators

Check the topbar in the UI — you should see green badges for:
- **PinchTab** — daemon is running and reachable
- **Claude CLI** — binary found and executable

If either is red, see [Troubleshooting](#troubleshooting) below.

## Using the App

### Scan for jobs

Click **SCAN** in the topbar. The scanner fetches jobs from configured Greenhouse, Ashby, Lever, and Remotive/RemoteOK portals. New jobs are prescreened instantly (zero tokens) using your blocklist, seniority, compensation, and location rules.

Results appear in the **Inbox** tab.

### Evaluate jobs

Click **EVALUATE** to run AI evaluation on all prescreened jobs. Uses Claude Haiku by default (~500 tokens/job after caching). Each job gets a score (0–10) and a verdict with pros/cons.

Evaluated jobs move to the **Evaluated** tab, sorted by score.

For a deeper analysis on a specific job, open the job drawer and click **Deep Eval** (uses Claude Sonnet).

### Apply to a job

Open a job from the **Evaluated** tab and click **Apply**. This:
1. Looks up cached answers for known form fields
2. Uses Claude to answer any new fields
3. Opens the application form in a browser via PinchTab
4. Fills in the form automatically
5. **Stops before submitting** — you review and click Submit manually

Applied jobs move to the **Applied** tab.

## Project Structure

```
apps/
  server/src/       — Fastify backend (port 3001)
  web/src/          — React + MUI frontend (port 5173)
packages/
  core/src/         — Shared prescreen logic and config loaders
config/             — YAML config files (profile, filters, cv) — gitignored
data/               — SQLite database — gitignored
docs/               — Detailed documentation
scripts/            — Utility scripts
```

## Config Files

These live in `config/` and are **not committed** (personal data):

| File | Purpose |
|---|---|
| `config/profile.yml` | Your info, target roles, compensation, prescreen rules |
| `config/filters.yml` | Portal list, job board queries, title filters |
| `config/cv.md` | Your CV in Markdown — injected into AI eval prompts |

A template is available at `config/filters.example.yml`.

## Utility Scripts

```bash
# Re-apply prescreen rules to all existing jobs in DB
node scripts/represcreen.mjs

# Dry run — shows what would change without writing to DB
node scripts/represcreen.mjs --dry-run
```

## Troubleshooting

**PinchTab badge is red**
```bash
pinchtab daemon status    # check if running
pinchtab daemon start     # start it
pinchtab daemon install   # re-install if missing
```

**Claude CLI badge is red**
```bash
which claude              # should return a path
claude --version          # should print version
# If missing, download from https://claude.ai/download
```

**Server won't start**
```bash
# Check if port 3001 is already in use
lsof -i :3001
# Check Node version
node -v   # must be ≥ 20
```

**Jobs not appearing after scan**
- Check **Settings → Filters** — ensure at least one portal is enabled
- Check that `config/filters.yml` exists; if not, go to **Settings → Import**

**Autofill opens a blank tab**
- Ensure PinchTab daemon is running: `pinchtab daemon status`
- Check the topbar health badge

## Documentation

| Topic | File |
|---|---|
| Full scan → eval → apply flow | [docs/PIPELINE.md](docs/PIPELINE.md) |
| Scanner adapter architecture | [docs/SCANNERS.md](docs/SCANNERS.md) |
| Config file schemas | [docs/CONFIG.md](docs/CONFIG.md) |
| Database tables and columns | [docs/DB-SCHEMA.md](docs/DB-SCHEMA.md) |
| PinchTab integration | [docs/PINCHTAB.md](docs/PINCHTAB.md) |
| Token costs and optimization | [docs/TOKEN-BUDGET.md](docs/TOKEN-BUDGET.md) |
| Stack choices and conventions | [docs/STACK.md](docs/STACK.md) |
| Setup and troubleshooting | [docs/SETUP.md](docs/SETUP.md) |
