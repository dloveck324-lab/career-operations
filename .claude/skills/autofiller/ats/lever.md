## ATS-specific notes (lever)

### URL shapes
- `jobs.lever.co/<company>/<uuid>` — job detail.
- `jobs.lever.co/<company>/<uuid>/apply` — application form (the server already rewrites via `toApplyUrl`).
- If you land on the detail page (no form visible), `pinchtab navigate <url>/apply` and re-snap.

### Step 0 — fast-fill standard fields (run this BEFORE snapping)

Lever's standard fields have stable `name` attributes. Build one quickfill batch from the
candidate profile and run it immediately — no snap needed for these fields.

CSS selectors and their profile sources:

| CSS selector | Profile field | Notes |
|---|---|---|
| `input[name="name"]` | `full_name` | Single full-name field |
| `input[name="email"]` | `email` | |
| `input[name="phone"]` | `phone` | |
| `input[name="org"]` | `current_company` | |
| `input[name="urls[LinkedIn]"]` | `linkedin_url` | |
| `input[name="urls[GitHub]"]` | `github_url` | |
| `input[name="urls[Portfolio]"]` | `portfolio_url` | |
| `input[name="urls[Other]"]` | `portfolio_url` (fallback) | Only if Portfolio not filled |
| `input[name="urls[Twitter]"]` | `twitter_url` | Skip if empty |

Example Step 0 quickfill call (substitute real values from profile):
```
bash <quickfill_path> '[
  {"ref":"input[name=\"name\"]","value":"Jane Doe"},
  {"ref":"input[name=\"email\"]","value":"jane@example.com"},
  {"ref":"input[name=\"phone\"]","value":"+1 555 123 4567"},
  {"ref":"input[name=\"org\"]","value":"Acme Corp"},
  {"ref":"input[name=\"urls[LinkedIn]\"]","value":"https://linkedin.com/in/janedoe"},
  {"ref":"input[name=\"urls[GitHub]\"]","value":"https://github.com/janedoe"}
]'
```

Only include fields where the profile value is non-empty.
After running, do a single `pinchtab snap -i -c` to see what remains unfilled.

### Form shape
- Single page. Sections: "Submit your application", "Links", "Additional Information".
- Confirm you're on the form: look for a "Resume/CV" file input and a "Full name" text input.

### Location field (React combobox — NOT in fast-fill)
Lever's location input does NOT have a stable `name`. Use click → type → snap → **read suggestions → click the right one**:
```
pinchtab click <location_ref>
pinchtab type <location_ref> "Scottsdale, AZ"   # city + state — NEVER just the city
pinchtab snap -i -c                              # read ALL suggestion labels
# Pick the suggestion whose text contains "AZ" / "Arizona" / "United States"
# NEVER click the first one blindly — it may be a different country
pinchtab click <ref_of_correct_suggestion>
pinchtab snap -i -c   # confirm committed value
```

If still ambiguous after city+state, type `"Scottsdale, AZ, United States"` and re-snap.

### Resume/CV
`input[type=file][name="resume"]` — **SKIP, add to `skipped`.**

### Custom / open-ended (Pass 4)
Common Lever prompts:
- "What's your desired role?"
- "Why are you interested in working at <Company>?"
- "Additional information" (free textarea)

Grounded answers from CV + JD — add each to `suggestions`.

### EEO section
Dropdowns for gender/race/veteran/disability at the bottom. Map from profile; fall back to "Decline to self-identify".

### Submit button
Labeled "Submit application". **NEVER click.**
