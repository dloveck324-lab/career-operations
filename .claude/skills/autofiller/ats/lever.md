## ATS-specific notes (lever)

### URL shapes
- `jobs.lever.co/<company>/<uuid>` — job detail.
- `jobs.lever.co/<company>/<uuid>/apply` — application form (the server already rewrites via `toApplyUrl`).
- If you land on the detail page (no form visible), `pinchtab navigate <url>/apply` and re-snap.

### Form shape
- Single page, tidy. Sections: "Submit your application", "Links", "Additional Information".
- Confirm you're on the form: look for a "Resume/CV" file input and a "Full name" text input.

### Standard fields (labels verbatim)
- "Full name" — single field. Use `profile.full_name` (not split).
- "Email" / "Phone" — self-explanatory.
- "Current company" — `profile.current_company`.
- "Resume/CV" — `input[type=file][name="resume"]`. **SKIP, note in `skipped`.**
- "LinkedIn URL" — `profile.linkedin_url`.
- "Other website" / "Portfolio / Github / Blog" — `profile.portfolio_url` or `profile.github_url`.

### Location (autocomplete combobox)
Lever's location input is a React combobox. `pinchtab fill` does NOT commit. Use:
```
pinchtab click <location_ref>
pinchtab type <location_ref> "San Franci"
pinchtab snap -i -c
pinchtab click <ref_of_suggestion>   # e.g. "San Francisco, CA, United States"
pinchtab snap -i -c                  # confirm value stuck
```

### Custom / open-ended (Pass 4)
Common Lever prompts:
- "What's your desired role?"
- "Why are you interested in working at <Company>?"
- "Additional information" (free textarea)

All grounded answers from CV + JD — add each to `suggestions`.

### EEO section
Lever shows a "U.S. Equal Employment Opportunity information" section at the bottom with gender/race/veteran/disability dropdowns. Map from profile; fall back to "Decline to self-identify".

### Submit button
Labeled "Submit application". **NEVER click.**
