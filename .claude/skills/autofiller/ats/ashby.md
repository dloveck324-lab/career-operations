## ATS-specific notes (ashby)

### URL shapes
- `jobs.ashbyhq.com/<company>/<job-uuid>` — detail.
- `jobs.ashbyhq.com/<company>/<job-uuid>/application` — form (server rewrites via `toApplyUrl`).
- If the form isn't visible, `pinchtab navigate <url>/application` and re-snap.

### Step 0 — fast-fill standard fields (run this BEFORE snapping)

Ashby's standard fields have stable `data-testid` attributes AND stable `name`/`type`
attributes as fallbacks. Build one quickfill batch and run it immediately.

Try the `data-testid` selector first; fall back to the CSS selector if that fails (different
Ashby versions differ slightly).

| Primary selector | Fallback selector | Profile field |
|---|---|---|
| `[data-testid="firstNameInput"]` | `input[name="firstName"]` | `first_name` (split `full_name` on first space) |
| `[data-testid="lastNameInput"]` | `input[name="lastName"]` | `last_name` (remainder of `full_name`) |
| `[data-testid="emailInput"]` | `input[type="email"]` | `email` |
| `[data-testid="phoneInput"]` | `input[type="tel"]` | `phone` |
| `[data-testid="linkedInInput"]` | `input[name*="linkedin" i]` | `linkedin_url` |
| `[data-testid="githubInput"]` | `input[name*="github" i]` | `github_url` |
| `[data-testid="websiteInput"]` | `input[name*="website" i]` | `portfolio_url` |
| `[data-testid="twitterInput"]` | `input[name*="twitter" i]` | `twitter_url` |

Some Ashby forms use a single "Name" field instead of First/Last:
- Try `[data-testid="nameInput"]` or `input[name="name"]` first.
- If that exists, use `full_name` and skip the split.

Example Step 0 quickfill call (substitute real values):
```
bash <quickfill_path> '[
  {"ref":"[data-testid=\"firstNameInput\"]","value":"Jane"},
  {"ref":"[data-testid=\"lastNameInput\"]","value":"Doe"},
  {"ref":"[data-testid=\"emailInput\"]","value":"jane@example.com"},
  {"ref":"[data-testid=\"phoneInput\"]","value":"+1 555 123 4567"},
  {"ref":"[data-testid=\"linkedInInput\"]","value":"https://linkedin.com/in/janedoe"},
  {"ref":"[data-testid=\"githubInput\"]","value":"https://github.com/janedoe"}
]'
```

Only include fields where the profile value is non-empty.
After running, do a single `pinchtab snap -i -c` to see what remains unfilled.

### Form shape
- Single long page, React-driven. Sections delimited by headings (no Next buttons between sections).
- `data-testid` attributes on most inputs — reliable fallback when refs change.

### Location field (React combobox — NOT in fast-fill)
Ashby location is an autocomplete combobox. Use click → type → snap → click-suggestion:
```
pinchtab click <location_ref>
pinchtab type <location_ref> "Phoenix"
pinchtab snap -i -c
pinchtab click <ref_of_suggestion>
```

If `type` fails to open the dropdown, dispatch an input event:
```
pinchtab eval "(() => { const el = document.querySelector('input[aria-label*=\"Location\"]'); el.focus(); el.value='Phoenix'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
pinchtab snap -i -c
pinchtab click <ref_of_suggestion>
```

Verify with follow-up snap — input should show the committed value.

### Resume / file upload
`input[type=file]` — **SKIP, add to `skipped`.**

### Custom questions
Ashby renders them inline (textareas, radios, checkboxes). Grounded Pass-4 answers → add to `suggestions`.

### EEO
Shown as radios for gender/race/veteran/disability. Click matching option; if profile empty, click "Decline to self-identify".

### Submit button
Labeled "Submit Application". **NEVER click.**
