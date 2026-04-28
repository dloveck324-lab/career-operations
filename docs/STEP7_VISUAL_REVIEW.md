# Step 7 Visual Review Checklist

A self-service walkthrough for verifying the dual-profile UI work landed correctly. Pair this with the dev server running at http://localhost:5173 (start via `npm run dev` from repo root).

If you've never re-scanned or run the backfill, your existing jobs all show `industry_vertical = unclassified`. To see the new badges in action, either:

- **Re-scan** from the UI (existing scan flow runs the new classifier on every job), or
- **Run the backfill CLI** to retroactively classify what's already in the DB:
  ```bash
  npx tsx scripts/classify-existing-jobs.ts --dry-run   # preview
  npx tsx scripts/classify-existing-jobs.ts             # apply
  ```

---

## Pipeline page — http://localhost:5173/pipeline

- [ ] Two new columns visible to the right of Role: **Industry** and **Directional**.
- [ ] Industry chip color-codes correctly:
  - `Healthcare` (primary blue)
  - `Generic` (default grey)
  - `?` (warning yellow — these are ambiguous jobs, you'll be prompted to pick a profile when applying)
  - `—` (default grey, dimmed — legacy unclassified jobs)
- [ ] Hovering each badge shows a tooltip explaining the state.
- [ ] **Directional** column shows a number 0-10 in a muted outlined chip. Sortable. Should NOT be color-coded — it's a sort hint, not a real eval.
- [ ] **Score** column (Claude eval) renders on the new 0-10 scale. Color thresholds:
  - 9.0+ green (strong)
  - 8.0+ blue (good)
  - 7.0+ yellow (marginal)
  - <7.0 red (avoid)

## Job detail drawer

- [ ] Click any job in the pipeline. Drawer opens on the right.
- [ ] Chip row near the top now includes the **Industry** badge alongside location, archetype, comp, score.
- [ ] For an **ambiguous** job, click "Apply" / "Auto Fill" → a dialog should open titled "Which profile should fill this application?" with two radio options (Generic / Healthcare). On mobile this dialog should be **fullscreen**.
- [ ] For a **healthcare** or **generic** classified job, Apply fires immediately (no dialog) — the backend resolves the variant from the job's tag.

## Settings → Profile tab — http://localhost:5173/settings

- [ ] Scroll to the **Narrative** section.
- [ ] At the top of that section: a `ToggleButtonGroup` with **Generic** and **Healthcare** options. Defaults to Generic.
- [ ] On the right: a "**Copy from Healthcare**" / "**Copy from Generic**" button (label flips based on the active variant).
- [ ] Switching the toggle should update the four narrative fields (Headline, Exit story, Superpowers, Proof points) to show the values stored under that variant.
- [ ] Clicking "Copy from [other]" should overwrite the active variant's narrative with the other variant's content. Useful when most of the content is the same and you only customize what's different.
- [ ] Other sections (Candidate, Compensation, Location, Prescreen) stay shared across variants — header explains this.

## Settings — top-level tabs

- [ ] Six tabs visible: CV / Profile / Scan / Portals / Field Mappings / Automation.
- [ ] On a narrow window (<600px) the tab strip should **scroll horizontally** with arrow buttons rather than wrapping or clipping.

## Mobile check (Chrome DevTools → device toolbar → iPhone SE 375px)

- [ ] Pipeline columns are accessible via horizontal scroll (the new columns shouldn't break the layout).
- [ ] Job drawer takes full screen width — chip row wraps cleanly.
- [ ] Apply confirmation dialog is **fullscreen** on small viewports.
- [ ] Settings → Profile narrative toggle and "Copy from" button stack **vertically** on xs, side-by-side on sm+.
- [ ] Proof points table inside the variant block is wrapped in `overflowX: auto` — should scroll horizontally instead of breaking layout.

## Backend behavior to spot-check

- [ ] Trigger an evaluation on an **ambiguous** job (Tier 2). Two evaluation rows should land in the DB — one per profile_variant. Check via:
  ```bash
  sqlite3 data/jobs.db "SELECT job_id, profile_variant, score FROM evaluations ORDER BY id DESC LIMIT 5"
  ```
- [ ] Run an autofill, then save a captured answer. Check it lands under the correct partition:
  ```bash
  sqlite3 data/jobs.db "SELECT question_text, profile_variant FROM field_mappings WHERE last_used_at > datetime('now', '-1 hour')"
  ```
- [ ] Pause + resume an autofill on the same job — the `Run.variant` should stay sticky (UI shows the same profile choice, save-mappings continues writing to the same partition).

## Known caveats

- The dev server in this branch was not browser-tested by the agent that built it — visual review here is the verification step.
- Three pre-existing typecheck errors in `apps/web/src/components/{CvForm,ProfileForm,ScanFiltersForm}.tsx` about a `SaveBar` `onSave` prop predate this work (Step 7 introduced zero new errors).
