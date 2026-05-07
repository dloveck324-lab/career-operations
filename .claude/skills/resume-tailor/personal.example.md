# Personal accuracy overlay for resume-tailor

This file holds candidate-specific tailoring rules. The base `SKILL.md` is generic. Copy this file to `personal.local.md` (gitignored) and customize for your own resume.

```bash
cp .claude/skills/resume-tailor/personal.example.md \
   .claude/skills/resume-tailor/personal.local.md
# then edit personal.local.md with your real values
```

When the resume-tailor skill runs, it loads `personal.local.md` first and applies its rules on top of the generic SKILL.md defaults.

---

## Candidate identity

Used to fill profile-related tokens that the base skill leaves generic.

- **Resume slug** (used in PDF filenames): `<candidate-slug>` (e.g., `david` for David Lovecchio)
- **LinkedIn display text**: `linkedin.com/in/<your-handle>`
- **Portfolio display text**: `<YourPortfolioDomain>.com`

## Sacred bullets — NEVER trim

Bullets from the roles listed below are non-negotiable. The 1-page enforcement loop must drop bullets from other roles before touching these.

- `<COMPANY_NAME>` (your primary proof-point employer where the bulk of your strongest metrics live)
- (Add additional sacred companies here, in priority order. Most candidates need only 1.)

## Personal phrasing rules

Specific framings the candidate cares about being EXACT. List incorrect framings to avoid and the correct version to use.

- **`<TOPIC>`**: never say `<incorrect framing>`. The correct framing is `<correct framing>`.
- (Example: never say "built/scaled the org from 4 to 17". The correct framing is "directly manages cross-functional pods within an org that grew from 4 to 17 during tenure".)

## Education spelling preferences

The base SKILL.md defaults to full official names with no abbreviations unless an override is listed here.

- **`<DEGREE>`**: write as `<preferred form>` (e.g., "Master of Business Administration (MBA)", never "MBA" alone).
- **`<SCHOOL>`**: write as `<preferred form>`, never `<form to avoid>` (e.g., "Penn State University", never "Pennsylvania State University").

## Project names (Applied AI Projects section)

Featured in the `{{PROJECTS}}` token, in priority order. Descriptions verbatim from `cv.md`.

1. `<Project 1 Name>` (URL, optional pw): description from cv.md
2. `<Project 2 Name>` (URL): description from cv.md
3. `<Project 3 Name>` (URL): description from cv.md

## Vertical-specific tailoring rules

Apply when the JD's vertical matches one of these.

### Healthcare

- **EHR/EMR**: default to `EHR/EMR-integrated` in prose (slash, no spaces) so ATS keyword matching catches either term. The Healthcare Skills line and Core Competencies tag should also use the slashed form. Exception: if the JD uses one term emphatically (e.g., "legacy EMR" as a strategic centerpiece), mirror that exact phrasing in the Summary's first sentence to maximize Jobscan exact-phrase match.
- Healthcare-priority order in `cv-healthcare.md` baseline (industry-specific tags before general PM tags).

### (Add other verticals here as needed)

- e.g., `### Fintech` with rules like "regulatory framing first" or "PCI/SOC 2 compliance signals"
- e.g., `### Edtech` with rules like "instructor experience above LMS specifics"

## Cover letter examples (candidate-specific)

The base SKILL.md has the universal cover-letter accuracy rule (content from cv.md only, no third-party company name borrowing). Add candidate-specific examples here:

- **Acceptable**: `At <my employer>, I built products serving <my employer's customers>.` (from cv.md)
- **Forbidden**: `...serving <BigCo>-caliber organizations.` (from a research report, not my experience)
