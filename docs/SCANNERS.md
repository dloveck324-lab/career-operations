# Scanner Adapters

## Overview

Scanners are pure async functions that return `RawJob[]`. They have no side effects — the runner handles DB writes.

```ts
// All adapters share this signature pattern:
async function scanX(companyId: string, companyName: string): Promise<RawJob[]>
```

`RawJob` (defined in `scanner/runner.ts`):
```ts
interface RawJob {
  source: string         // 'greenhouse' | 'ashby' | 'lever' | 'indeed_rss'
  external_id: string    // stable ID for dedup
  url: string
  company: string
  title: string
  location?: string
  remote_policy?: string
  comp_text?: string
  description?: string   // plain text (HTML stripped)
  raw_text?: string
}
```

## Adapters

### Greenhouse (`scanGreenhouse`)
- Endpoint: `https://boards-api.greenhouse.io/v1/boards/{companyId}/jobs?content=true`
- Returns full job description HTML in `content` field — stripped to plain text
- `external_id`: Greenhouse job ID (number → string)
- No auth required. Public API.

### Ashby (`scanAshby`)
- Endpoint: `https://api.ashbyhq.com/posting-api/job-board/{companyId}`
- Returns `isRemote` boolean — mapped to `remote_policy: 'remote'`
- `descriptionHtml` stripped to plain text
- `external_id`: Ashby UUID
- No auth required. Public API.

### Lever (`scanLever`)
- Endpoint: `https://api.lever.co/v0/postings/{companyId}?mode=json`
- Returns `salaryRange` when available — mapped to `comp_text`
- `categories.workplaceType === 'remote'` for remote detection
- `descriptionPlain` preferred over HTML `description`
- `external_id`: Lever UUID
- No auth required. Public API.

### Indeed RSS (`scanIndeedRss`)
- Endpoint: `https://www.indeed.com/rss?q={query}&sort=date&limit=25`
- RSS XML parsing without external library (regex-based)
- `external_id`: sha256(link) first 16 chars
- Coverage: ~30% of total Indeed listings
- Rate limits: conservative (one query at a time in runner)
- **Note:** Subject to Indeed ToS. Use responsibly.

## Adding a new adapter

1. Create `apps/server/src/scanner/adapters/<ats>.ts`
2. Export `async function scan<Ats>(id: string, name: string): Promise<RawJob[]>`
3. Call `stripHtml()` on any HTML descriptions (copy from existing adapters)
4. Add the ATS type to `FiltersConfig.portals[].type` in `packages/core/src/config.ts`
5. Import and call in `scanner/runner.ts` → `runScan()` → new `Promise.allSettled` entry

## Error handling in runner

`Promise.allSettled` wraps all adapter calls. A single adapter failure emits an SSE `error` event but doesn't abort the whole scan. The UI shows the error message in the progress line.

## Portals config (`config/filters.yml`)

```yaml
portals:
  - name: Anthropic
    type: greenhouse
    company_id: anthropic
    enabled: true
```

`company_id` is the ATS-specific identifier:
- Greenhouse: the slug used in `boards-api.greenhouse.io/v1/boards/{slug}`
- Ashby: the slug used in `api.ashbyhq.com/posting-api/job-board/{slug}`
- Lever: the slug used in `api.lever.co/v0/postings/{slug}`

To find a company's ATS and ID: open their careers page and inspect the URL or page source. Career-ops reference has 45+ pre-mapped in `portals.example.yml`.
