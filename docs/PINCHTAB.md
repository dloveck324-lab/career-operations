# PinchTab Integration

## What It Is
PinchTab is a local HTTP daemon (~15MB Go binary) that gives the server programmatic control over Chrome. It uses a named-profile model — Chrome state (cookies, logged-in sessions, local storage) persists across uses.

## Setup
```bash
curl -fsSL https://pinchtab.com/install.sh | bash
pinchtab daemon install   # runs as background service
```
Token is auto-stored in `~/.pinchtab/config.json` and read by `PinchTabClient` at startup.

## Architecture

```
Server (Fastify)
    └─ PinchTabClient (autofill/pinchtab.ts)
           ├─ http://127.0.0.1:9867  ← management API (profiles, instance lifecycle)
           └─ http://127.0.0.1:9868  ← instance API (nav, snap, fill, click)
```

## Key API calls used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Check daemon is alive |
| POST | `/instances/start` | Launch a Chrome instance (`headless` or `headed`) |
| POST | `/nav` | Navigate to URL |
| POST | `/snap` | Get interactive elements (returns `e1`, `e2`... refs) |
| POST | `/fill` | Fill an input by element ref |
| POST | `/click` | Click an element by ref |
| POST | `/text` | Extract page text |
| POST | `/instances/show` | Make headless instance visible |

## Headless vs Headed mode

Default: **headless** (background). User never sees a browser window.
Toggle: **"Auto-fill (visible)"** button in the JobDetailDrawer → passes `showBrowser: true` → `POST /api/apply/:id { showBrowser: true }`.

After filling, `autofill.ts` always calls `client.showBrowser()` so the user can review before submitting — even in headless mode the browser becomes visible at review time.

**The `autofill.ts` code NEVER clicks Submit.** The submit button is detected by label (`isSubmitButton()`) and skipped. The user clicks Submit manually.

## Element ref model

`snap()` returns elements like:
```json
{
  "elements": [
    { "ref": "e1", "tag": "input", "type": "text", "label": "First name", "placeholder": "" },
    { "ref": "e7", "tag": "input", "type": "submit", "label": "Submit application" }
  ]
}
```

`fill("e1", "John")` fills the element. `isSubmitButton("Submit application")` returns `true` → skipped.

## Field Mappings Cache

`field_mappings` DB table maps `hash(question_text)` → `answer`.
`lookupFieldMapping(label)` is called for every input before any Claude call.
`saveFieldMapping(label, answer, atsType)` is called for every miss answer.

Cache grows organically:
- First Greenhouse application: ~12 fields → one Claude call → 12 new mappings stored
- Second Greenhouse application: all 12 hit the cache → 0 tokens

## Health Check
`GET /api/settings/status` → `pinchtab: { ok: boolean, message?: string }`.
AppShell shows a green/amber indicator. If amber, hovering shows the install hint.

## ATS Detection
`detectAtsType(url)` in `autofill.ts` tags each mapping with its ATS type:
- `greenhouse.io` → `greenhouse`
- `ashbyhq.com` → `ashby`
- `jobs.lever.co` → `lever`
- `myworkdayjobs.com` → `workday`
- else → `custom`

This lets you filter mappings in Settings → Field Mappings tab by ATS.
