## ATS-specific notes (workday)

**Workday is the hardest ATS.** Multi-step, auth-walled, anti-bot. Expect to emit `blocked` often.

### URL shape
- `<company>.myworkdayjobs.com/en-US/<board>/job/<location>/<title>_<req-id>`
- Apply starts via an "Apply" button that expands options: "Apply Manually", "Apply with LinkedIn", "Autofill with Resume". Always prefer the Manual path unless "Autofill with Resume" is visible AND a resume is configured.

### Account wall — STOP if you hit it
First step is usually a **Sign In / Create Account** page. The form displays "Email", "Password", "Create Account" tabs.

- If you see this without cookies indicating a signed-in session, emit:
  ```json
  { "blocked": "Workday account required — user must sign in first", ... }
  ```
- **DO NOT attempt to create an account.** Do NOT fill email/password. Stop immediately.

### Multi-step flow (when signed in)
Typical step order:
1. **My Information** — name, address, phone, email, previous employment checkbox.
2. **My Experience** — work history (repeater), education, skills, resume upload, websites.
3. **Application Questions** — role-specific questions, work authorization, sponsorship.
4. **Voluntary Disclosures** — EEO-ish prompts, government employment.
5. **Self Identify** — gender, race, veteran status.
6. **Review** — final page. **STOP HERE.** Do not click Submit.

Each step ends with a "Save and Continue" button (sometimes "Next"). Click it, wait for navigation, re-snap, run passes 1–6 on the new step.

### "Autofill with Resume" shortcut
If this button is visible on step 1 and a resume path is configured in `profile.resume_path`, click it first — it pre-populates name, email, work history, and education, saving many turns. Still re-snap and fill gaps afterward.

### Repeater fields (work history, education)
Workday uses "Add Another" buttons. Add only the top 2–3 most relevant entries from CV. Don't exhaustively enumerate every line.

### Dropdowns
Workday dropdowns are custom widgets — `<select>` syntax won't work. Use click-to-open → click-option:
```
pinchtab click <dropdown_ref>
pinchtab snap -i -c
pinchtab click <option_ref>
```

### Required markers
Fields have red asterisks. Honor required fields strictly; skip optional fields if no profile data exists.

### Submit button
Labeled "Submit" on the Review page. **NEVER click.** When you reach the Review page, stop and emit the output JSON.
