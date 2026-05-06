---
name: resume-tailor
description: Generate a tailored, ATS-optimized resume PDF for a specific job description. Reads cv-generic.md or cv-healthcare.md based on JD vertical, extracts keywords, fills the resume template, and renders via packages/renderer to a single-page PDF. Invoke with `/resume-tailor` followed by the JD text or URL.
user-invocable: true
---

You generate tailored, ATS-optimized resume PDFs for David Lovecchio. Output must be a single page, fully ATS-parseable, and never invent content. Follow every rule in this file. The renderer at `packages/renderer/generate-pdf.mjs` produces the PDF; this skill produces the tailored HTML that feeds it.

## Pipeline

1. Read `config/cv-<variant>.md` (the CV markdown source of truth) and `config/profile.yml` (personal info: name, email, phone, LinkedIn, location).
2. Determine `<variant>` per the **Variant selection** rules below.
3. If the JD is not in context, ask the user for it (text or URL). If a URL, fetch the page and extract the JD text.
4. Extract 15-20 high-signal keywords from the JD (skills, tools, domain terms, role responsibilities). Cluster them by relevance.
5. Detect role archetype from the JD (AI platform, agentic workflows, technical PM, solutions architect, transformation lead, etc.) and use it to shape the framing.
6. Rewrite Professional Summary (3-4 lines) to inject the highest-priority JD keywords plus David's exit narrative. The exit narrative should signal availability and direction, not explain departure circumstances.
7. Build Core Competencies grid: 6-8 short keyword phrases pulled from JD requirements, blended with David's existing competencies from cv.md.
8. Tailor experience bullets per role: reorder by JD relevance, reframe wording to surface JD keywords, **never invent metrics**. eVisit bullets are sacred (see Accuracy guardrails).
9. Read the template at `packages/renderer/templates/resume.html`. Substitute every `{{TOKEN}}` with the rendered content. Use the section labels from the **Template fill map** below verbatim.
10. Write the filled HTML to `/tmp/resume-tailored-<company-slug>-<YYYY-MM-DD>.html`.
11. Render the PDF:
    ```bash
    node packages/renderer/generate-pdf.mjs \
      /tmp/resume-tailored-<company-slug>-<YYYY-MM-DD>.html \
      packages/renderer/output/resume-david-<company-slug>-<YYYY-MM-DD>.pdf
    ```
12. Run the **Post-generation verification** checklist before reporting done.
13. Report: PDF path, page count, file size, plus a one-line summary of which bullets were reordered or which keywords were injected.

## Variant selection

If the user names a variant (`generic` or `healthcare`), use it.

Otherwise, classify the JD's vertical using `classifyVertical()` from `packages/core` (or the prescreen rules in `config/profile.yml`). Use these results:

- vertical = `healthcare` -> `config/cv-healthcare.md`
- any other vertical -> `config/cv-generic.md`

If the classifier is uncertain or returns ambiguous, **ask the user before proceeding**. Do not silently default. A wrong variant ships keywords from the wrong industry.

## Template fill map

The template at `packages/renderer/templates/resume.html` exposes these tokens. Fill them with the values below verbatim (these are tuned for ATS parsers like Jobscan that whitelist specific section labels):

| Token | Value the skill must emit |
|---|---|
| `{{LANG}}` | `en` |
| `{{NAME}}` | From `config/profile.yml` (`David Lovecchio`) |
| `{{PHONE}}` | From profile |
| `{{EMAIL}}` | From profile |
| `{{LINKEDIN_URL}}` | From profile |
| `{{LINKEDIN_DISPLAY}}` | `linkedin.com/in/dave-lovecchio` |
| `{{PORTFOLIO_URL}}` | From profile |
| `{{PORTFOLIO_DISPLAY}}` | `DavidGLovecchio.com` |
| `{{LOCATION}}` | From profile (`Scottsdale, AZ 85251`) |
| `{{SECTION_SUMMARY}}` | `Professional Summary` |
| `{{SUMMARY_TEXT}}` | Tailored 3-4 line summary (see Pipeline step 6) |
| `{{SECTION_COMPETENCIES}}` | `Core Competencies` |
| `{{COMPETENCIES}}` | 6-8 `<span class="competency-tag">` elements |
| `{{SECTION_EXPERIENCE}}` | **`Professional Experience`** (NOT "Work Experience" — Jobscan rejects that label) |
| `{{EXPERIENCE}}` | Tailored job blocks, reverse chronological |
| `{{SECTION_PROJECTS}}` | `Applied AI Projects` |
| `{{PROJECTS}}` | Vecchio, Furniture Curator, Career-ops (from cv.md) |
| `{{SECTION_EDUCATION}}` | `Education` |
| `{{EDUCATION}}` | MBA + BS entries (see Education spelling rule) |
| `{{SECTION_CERTIFICATIONS}}` | `Certifications` (omit the entire section block if there's no content) |
| `{{CERTIFICATIONS}}` | Empty unless cv.md has certs |
| `{{SECTION_SKILLS}}` | `Skills` |
| `{{SKILLS}}` | The Skills section from cv.md, formatted as `.skill-item` blocks |

## Date format

Always emit dates in the formats Jobscan and most ATS parsers accept:

- Currently held role: `Aug 2020 - Present`
- Date range: `2017 - 2018` for year-only, `Aug 2017 - Dec 2018` for month precision
- Banned format: `August 2020 - Present` with a full month name plus en-dash
- Single year: `2019` (for short internships when month doesn't matter)

Use ASCII hyphen (`-`), never en-dash or em-dash.

## 1-page enforcement loop — MANDATORY

After every render, check the page count from generate-pdf.mjs.

If `pageCount > 1`:

1. Score every trimmable bullet against the JD. **Bullets in eVisit roles are NOT trimmable.**
2. Drop the lowest-scoring bullet.
3. Regenerate.
4. Check page count again.
5. Repeat until `pageCount === 1`.
6. Never exit with a 2-page PDF. Never trim an eVisit bullet. Never leave any role with zero bullets.

If you cannot reach a single page without violating these rules, stop and report the constraint conflict to the user. Do not deliver a 2-page PDF.

## Accuracy guardrails — VERBATIM

- **Never** say David "built" or "scaled" the product org from 4 to 17. The correct framing: "directly manages cross-functional product and engineering pods within a product org that grew from 4 to 17 during his tenure."
- **Never** invent metrics, titles, dates, or experience not in `cv-<variant>.md`.
- **Never** abbreviate education. Always: "Master of Business Administration (MBA)" and "Penn State University". **Do not write "Pennsylvania State University".** It's "Penn State University" or "Penn State", that's how David refers to his alma mater.
- Keyword injection must reframe existing experience, not add new claims.

## Cover letter accuracy guard (preserved for when cover letter template lands)

Cover letter content MUST come exclusively from `cv-<variant>.md`. No exceptions.

- Never reference a target company's customer names, investor names, partnerships, or third-party companies as if David has personal experience with them.
- Evaluation reports contain target-company research (e.g., "Yale New Haven and Stanford are Clarium customers"). This is context about the prospect, not David's background.
- Acceptable: "At eVisit, I built products serving 35K beds across all 50 states." (from cv.md)
- Forbidden: "...serving Yale New Haven and Stanford-caliber organizations." (from a research report, not David's experience)

If you are not 100% certain a statement comes directly from `cv.md`, do not include it.

## Language and formatting

- No em-dashes, no en-dashes, no double-dashes. Use periods, commas, colons, parentheses, or restructure. Hyphens only in compound words (cross-functional, data-driven, player-coach).
- No filler vocabulary: avoid `delve`, `unleash`, `harness`, `tapestry`, `navigate` (as metaphor), `leverage` (as verb), `robust`, `seamless`, `streamline`, `empower`, `bolster`, `foster`, `bespoke`, `holistic`, `multifaceted`, `crucial`, `vital`, `paramount`, `elevate`, `unveil`, `transformative`, `revolutionize`, `optimize` (use specific outcome instead), `end-to-end`, `best-in-class`, `cutting-edge`.
- No "It's not just X, it's Y" reframes.
- English only.
- Leadership & Mentorship section: render as `<div>` elements, NOT `<ul><li>`.
- Links must never break across lines (`a { white-space: nowrap }` is in the template CSS already).

## Page format — MANDATORY

- Always US Letter (8.5in × 11in).
- Render with `--format=letter` (or omit, since letter is default). **Never** pass `--format=a4`.
- Zero Playwright margins. The template's `.page` div handles its own padding (0.38in × 0.5in).

## Section order

1. Header (name, teal rule, contact row)
2. Professional Summary (3-4 lines, keyword-dense)
3. Core Competencies (6-8 tags)
4. Professional Experience (reverse chronological)
5. Applied AI Projects
6. Education
7. (Certifications — only if non-empty)
8. Skills

## Post-generation verification — ALWAYS RUN

Before reporting done:

1. **Font embedding** — generate-pdf.mjs output must show `Embedded font:` lines for each woff2 actually referenced. If any are missing, stop and fix.
2. **Bullets present** — read the rendered HTML and confirm every `.job` block has at least one `<li>`.
3. **Page count = 1** — confirm against the script's reported page count.
4. **Spot-check content** — Professional Summary present, Applied AI Projects section present, eVisit bullets all present (eVisit is the primary proof point and must never be trimmed).
5. **Section labels** — confirm the rendered text layer reads `Professional Experience` and `Education` (not `WORK EXPERIENCE` / `EDUCATION`). Run `pdftotext` if uncertain.

Never report the PDF as done without all five checks.

## Report format

Reply with:

```
PDF: packages/renderer/output/resume-david-<slug>-<date>.pdf
Pages: 1
Size: <N> KB
Variant: <generic|healthcare>
Tailoring decisions:
  - <one-line summary of which bullets were reordered, which keywords injected>
```

Keep the report under 8 lines. The PDF speaks for itself.
