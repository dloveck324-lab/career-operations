## ATS-specific notes (generic)

No ATS-specific knowledge is available for this hostname. Be extra cautious and re-snap more often than usual.

### Orient yourself first
1. `pinchtab text` — read the page. Is it a job detail or the application form?
2. If it's a detail page, look for an "Apply" / "Apply Now" / "Apply for this job" button. Click it and re-snap.
3. Confirm you're on a form: look for a `<form>` with many inputs, or a card whose heading includes "Application", "Apply", "Your Details", or similar.

### Auth walls
If you see a sign-in / sign-up prompt (email + password fields, "Create account" button, OAuth buttons like "Continue with Google"), stop:
```json
{ "blocked": "Authentication required", ... }
```
DO NOT attempt to create an account.

### Execute the standard passes
Follow the main skill's pass order exactly (1: mapping quickfill → 2: profile text → 3: profile radios/selects → 4: grounded open-ended → skip uploads → Next/re-snap for multi-step).

### Dropdowns and comboboxes
- Try `pinchtab select` first for `<select>` elements.
- For anything else that looks like a dropdown (React combobox, custom widget), use click → type → snap → click-suggestion.
- Location fields should be treated as comboboxes by default — plain `fill` rarely commits. Always type city + state (e.g. `"Scottsdale, AZ"`), snap, **read all suggestion labels**, then click the one matching "AZ" / "Arizona" / "United States". Never click the first suggestion blindly — it is often a different country.

### Submit button patterns to AVOID clicking
Any button with text matching these, case-insensitive:
- "Submit"
- "Submit Application"
- "Send application"
- "Apply" (only on the final step — apply-on-detail is fine to click to reach the form)
- "Finish"
- "Complete Application"

### When in doubt
- Re-snap. Screens change, especially after toggles/radios.
- Prefer leaving a field blank over guessing — blanks show up as `skipped`, wrong answers don't.
- If the page structure is truly unfamiliar and no fields match mappings or profile, emit `blocked: "Unrecognized form structure"` and stop.
