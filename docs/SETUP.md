# Setup Guide

## Prerequisites

| Requirement | Check | Install |
|---|---|---|
| Node.js ≥ 20 | `node -v` | https://nodejs.org |
| Claude CLI | `which claude` | https://claude.ai/download |
| PinchTab | `pinchtab --version` | `curl -fsSL https://pinchtab.com/install.sh \| bash` |

## First Run

```bash
# 1. Install dependencies
cd "Dave Search Job App"
npm install

# 2. Start the app
npm run dev
# → Server: http://127.0.0.1:3001
# → Web UI: http://localhost:5173

# 3. Start PinchTab daemon (needed for autofill)
pinchtab daemon install
```

## Initial Setup in the UI

1. Open http://localhost:5173
2. Go to **Settings → Import**
3. Click **Import from Dave's job search** — imports your profile, CV, portals, and field mappings
4. Verify the green indicators in the topbar (PinchTab ✓, Claude CLI ✓)
5. Go to **Settings → Filters** and enable/disable portals as needed

If you don't have a `Dave's job search` project, go to:
- **Settings → Profile** — paste your profile JSON
- **Settings → CV** — paste your CV in Markdown
- **Settings → Filters** — configure portals (see `config/filters.example.yml`)

## Running a Scan

1. Click **SCAN** in the topbar
2. Watch the progress counter update live
3. When scan completes, click **EVALUATE** (or it runs automatically)
4. Jobs appear in the **Evaluated** tab sorted by score

## Applying to a Job

1. Click a row in the **Evaluated** tab to open the detail drawer
2. Click **Auto-fill (background)** — PinchTab fills the form in headless Chrome
3. The browser window appears for your review
4. Review all fields, make corrections, click **Submit** manually
5. Return to the dashboard and click **Mark Applied**

## Troubleshooting

**"PinchTab not reachable"** — run `pinchtab daemon install` then `pinchtab daemon start`

**"claude CLI not found"** — verify `which claude` returns a path. If Claude Code is installed, the CLI should be available.

**"No config found"** — go to Settings → Import to seed config files.

**Scan returns 0 results** — check `config/filters.yml` exists and has `enabled: true` portals. Verify company IDs are correct by testing the API URL in a browser.

**Evaluate produces no score** — check Claude CLI is working: `echo "test" | claude -p "say hi" --dangerously-skip-permissions`
