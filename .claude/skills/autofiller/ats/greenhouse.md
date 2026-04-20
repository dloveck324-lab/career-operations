## ATS-specific notes (greenhouse)

### URL shapes
- `boards.greenhouse.io/<company>/jobs/<id>` — canonical application page (form is inline).
- `<company>.greenhouse.io/jobs/<id>` — custom-subdomain variant.
- Embedded iframe on company career sites — the URL bar shows the company domain but the form is still Greenhouse markup. Look for `job_application` in field `name` attributes to confirm.
- No URL rewrite is needed — the job URL IS the application URL.

### Form shape
- Single long page. No "Next" step. Scroll through, fill everything, stop at the submit button.
- A "Save for later" button sometimes appears next to Submit — **DO NOT click it**. It requires an account.

### Standard fields (match labels loosely)
- First Name / Last Name / Email / Phone — text inputs.
- Resume/CV — `input[type=file][name="job_application[resume]"]`. **SKIP file uploads**, note in `skipped`.
- Cover Letter — same pattern, usually optional textarea + file input. Fill the textarea from CV grounding if required.
- LinkedIn Profile / Website — `job_application[answers_attributes][N][text_value]` style inputs. Use profile URLs.
- "How did you hear about us?" — `<select>`. Map from `profile.how_did_you_hear`.

### Work authorization / sponsorship (radios or selects)
- "Are you legally authorized to work in the US?" — profile `work_authorization_us` → Yes/No.
- "Will you now or in the future require sponsorship?" — profile `requires_sponsorship` → Yes/No.
- "Are you willing to relocate?" — profile `willing_to_relocate`.

### EEO / voluntary disclosures (bottom of page)
Greenhouse always appends these as `<select>` dropdowns:
- Gender — profile `gender`
- Race/Ethnicity — profile `race_ethnicity`
- Veteran status — profile `veteran_status`
- Disability status — profile `disability_status`

If the profile value is empty, select "Decline to self-identify" / "I don't wish to answer" — these options are always present.

### Custom questions
Live under an "Additional Information" or "Questions" section. Treat every textarea as Pass 4 (grounded answer, ADD to `suggestions`).

### Location
Greenhouse location fields are sometimes plain text, sometimes an autocomplete combobox.
- Try `pinchtab fill <ref> "Scottsdale, AZ"` first. If the value doesn't stick (it shows blank or a placeholder after Tab), switch to the combobox pattern.
- **Combobox pattern**: click → type `"Scottsdale, AZ"` (city + state) → snap → **read ALL suggestion labels** → click the one containing "AZ" / "Arizona" / "United States". Never click the first suggestion blindly.

### Submit button
Labeled "Submit Application". **NEVER click.**
