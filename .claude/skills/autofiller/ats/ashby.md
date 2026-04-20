## ATS-specific notes (ashby)

### URL shapes
- `jobs.ashbyhq.com/<company>/<job-uuid>` — detail.
- `jobs.ashbyhq.com/<company>/<job-uuid>/application` — form (server rewrites via `toApplyUrl`).
- If the form isn't visible, `pinchtab navigate <url>/application` and re-snap.

### Form shape
- Single long page, React-driven. Sections delimited by headings (no Next buttons between them — just scroll).
- Fields often have `data-testid` attributes — useful selector fallback (`pinchtab click '[data-testid="..."]'`).

### Standard fields
- "Name" (single field) — use `profile.full_name`.
- "Email" / "Phone" — standard inputs.
- "Resume" or "Upload resume" — `input[type=file]`. **SKIP, note in `skipped`.**
- "LinkedIn" / "Website" / "GitHub" — from profile.

### Location — the known pain point
Ashby's location field is a React combobox. `pinchtab fill` ALONE DOES NOT COMMIT the value. Use the click → type → snap → click-suggestion pattern:
```
pinchtab click <location_ref>
pinchtab type <location_ref> "San Franci"
pinchtab snap -i -c
pinchtab click <ref_of_suggestion>
```

If `type` fails to open the dropdown, fall back to manual `input` event dispatch:
```
pinchtab eval "(() => { const el = document.querySelector('input[aria-label*=\"Location\"]'); el.focus(); el.value='San Francisco'; el.dispatchEvent(new Event('input',{bubbles:true})); })()"
pinchtab snap -i -c
pinchtab click <ref_of_suggestion>
```

Verify with a follow-up snap — the input should now show the committed value AND a chip/pill element.

### Custom questions
Ashby renders them inline (textareas, radios, checkboxes). Grounded Pass-4 answers → add to `suggestions`.

### EEO
Shown as radios (not selects) for gender/race/veteran/disability. Click the matching option; if profile is empty, click "Decline to self-identify".

### Submit button
Labeled "Submit Application". **NEVER click.**
