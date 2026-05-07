---
name: cover-letter-tailor
description: Generate a tailored, ATS-parseable cover letter PDF for a specific job description. Reads cv-generic.md or cv-healthcare.md based on JD vertical, writes prose paragraphs grounded in the candidate's actual experience, fills the cover letter template, and renders via packages/renderer to a single-page PDF. Invoke with `/cover-letter-tailor` followed by the JD text or URL.
user-invocable: true
---

You generate tailored, ATS-parseable cover letter PDFs. Output must be a single page, fully ATS-parseable, and never invent claims. Follow every rule in this file. The renderer at `packages/renderer/generate-pdf.mjs` produces the PDF; this skill produces the tailored HTML that feeds it.

## Personal overlay (load FIRST)

Before applying any rule below, load `.claude/skills/cover-letter-tailor/personal.local.md` from this folder if it exists. That file holds candidate-specific cover-letter rules: signature image path, typed-title tagline, addressee defaults, tone preferences, and any candidate-specific accuracy guardrails.

If `personal.local.md` is present, its rules take precedence over any conflicting defaults below.

If it's not present, see `personal.example.md` for the expected structure and apply only the generic defaults in this file.

## Pipeline

1. Read `config/cv-<variant>.md` (the CV markdown source of truth) and `config/profile.yml` (personal info: name, email, phone, LinkedIn, location). Read `personal.local.md` for cover-letter-specific rules.
2. Determine `<variant>` per the **Variant selection** rules below.
3. If the JD is not in context, ask the user for it (text or URL). If a URL, fetch the page and extract the JD text.
4. Identify the company name, role title, and (if available) hiring manager or team name from the JD.
5. Pick 2-3 proof points from `cv-<variant>.md` that align with the JD's most-emphasized requirements. **Never reach beyond cv.md for proof points** (see Cover letter accuracy guard).
6. Draft three paragraphs:
   - **Opening**: 2-3 sentences. Hook with the candidate's positioning + why this role specifically. Anchor in 1 proof point.
   - **Body**: 3-5 sentences. The 2-3 proof points with metrics, framed for JD relevance. Use `<strong>` sparingly on key numbers.
   - **Closing**: 2-3 sentences. Specific reason this company is the fit + a low-key invitation to talk.
7. Read the template at `packages/renderer/templates/cover-letter.html`. Substitute every `{{TOKEN}}` with the rendered content. Use the values from the **Template fill map** below.
8. Write the filled HTML to `/tmp/cover-letter-tailored-<company-slug>-<YYYY-MM-DD>.html`.
9. Render the PDF:
    ```bash
    node packages/renderer/generate-pdf.mjs \
      /tmp/cover-letter-tailored-<company-slug>-<YYYY-MM-DD>.html \
      packages/renderer/output/cover-letter-<candidate-slug>-<company-slug>-<YYYY-MM-DD>.pdf
    ```
10. Run the **Post-generation verification** checklist before reporting done.
11. Report: PDF path, page count, file size, plus a one-line summary of which proof points were used.

## Variant selection

Same as resume-tailor:

- If the user names a variant (`generic` or `healthcare`), use it.
- Otherwise classify the JD's vertical via `classifyVertical()` from `packages/core` (or prescreen rules in `config/profile.yml`):
  - `healthcare` → `config/cv-healthcare.md`
  - other → `config/cv-generic.md`
- If ambiguous, **ask the user**.

## Template fill map

The template at `packages/renderer/templates/cover-letter.html` exposes these tokens:

| Token | Value the skill must emit |
|---|---|
| `{{LANG}}` | `en` |
| `{{NAME}}` | From `config/profile.yml` |
| `{{PHONE}}` | From profile |
| `{{EMAIL}}` | From profile |
| `{{LINKEDIN_URL}}` | From profile |
| `{{LINKEDIN_DISPLAY}}` | From `personal.local.md` |
| `{{PORTFOLIO_URL}}` | From profile |
| `{{PORTFOLIO_DISPLAY}}` | From `personal.local.md` |
| `{{LOCATION}}` | From profile |
| `{{DATE}}` | Today's date in `Month D, YYYY` format (e.g., `May 7, 2026`) |
| `{{ADDRESSEE_LINE1}}` | Hiring manager name if known, otherwise `Hiring Team` (or per `personal.local.md` default) |
| `{{COMPANY_NAME}}` | From the JD |
| `{{ROLE_TITLE}}` | From the JD (exact title, e.g., `Head of Product`) |
| `{{SALUTATION}}` | `Dear <Hiring Manager Name>,` if known, otherwise `Dear <Company> Hiring Team,` |
| `{{BODY_PARAGRAPHS}}` | 3 `<div class="paragraph">…</div>` blocks: opening, body, closing (per Pipeline step 6) |
| `{{LIST_INTRO}}` | Optional transition paragraph that bridges the body to the projects list. Format: `<div class="paragraph" style="margin-bottom: 6px;">…</div>`. Emit empty string if the projects list is not included. |
| `{{PROJECTS_LIST}}` | Optional `<ul class="cover-letter-projects-list">` with `<li>` items. Format per item: `<strong>Name</strong> (<a href="...">link</a>): description`. Descriptions verbatim from cv.md. Emit empty string if no projects section is needed. |
| `{{CLOSING_LINE}}` | `Thank you for your consideration,` (or per `personal.local.md` preference) |
| `{{SIGNATURE_BLOCK}}` | If `personal.local.md` defines `signature_image_path`, render `<img class="signature-img" src="data:image/png;base64,…">`. The renderer's font-base64 mechanism doesn't auto-embed images, so the skill must base64-encode and inline. If no signature path, emit empty string. |
| `{{TYPED_TITLE}}` | Per `personal.local.md` (e.g., `Product Leader \| Applied AI \| YourPortfolio.com`) |

## Date format

Cover letters use the spelled-out month, not the abbreviated form used on resumes:

- `May 7, 2026` (correct)
- `5/7/26` (avoid, less professional)
- `May 7th, 2026` (avoid, ordinals look casual)

## 1-page enforcement loop — MANDATORY

Cover letters must always be 1 page.

If `pageCount > 1`:

1. Trim the body paragraph (the middle paragraph) by removing the lowest-relevance sentence.
2. Regenerate.
3. Repeat until 1 page.
4. Never compress all three paragraphs into one (it loses the rhythm).
5. Never cut the closing paragraph (it carries the call to action).

If trimming the body still leaves you over 1 page, ask the user: do you want to drop a proof point or shorten the opening?

## Projects mini-section (optional)

Some JDs warrant a compact bullet list of relevant side projects between the body paragraph and the closing paragraph. Use it when:

- The JD emphasizes hands-on AI/ML work, building, or shipping (Savas, AI platform roles, build-phase startups).
- The candidate's `cv.md` has an Applied AI Projects section with content directly relevant to the JD's vertical or technical stack.

Skip it when:

- The JD is for a senior-management or strategy role with no signal about hands-on work.
- Including it would push the cover letter past 1 page (the 1-page enforcement loop drops it before trimming the body).

**Format:**

1. **`{{LIST_INTRO}}`** is one short transition sentence as a `<div class="paragraph" style="margin-bottom: 6px;">…</div>`. The sentence connects the body's theme to the bullets and references the candidate's primary employer. Examples:
   - `Outside of <employer>, I've been productizing the same AI-first approach across three side projects:`
   - `These same instincts show up in side projects I've shipped on my own time:`
   - Avoid generic resume-style headers like `Applied AI Projects` as a section heading. Cover letters are prose; the transition sentence is the framing.

2. **`{{PROJECTS_LIST}}`** is a `<ul class="cover-letter-projects-list">` with `<li>` items. Each item: `<strong>Name</strong> (<a href="...">link</a>): one-sentence description`. Pull descriptions from cv.md verbatim. 2-3 projects max. Order by JD relevance (most-relevant project first).

If you skip the section, emit empty string (`""`) for both tokens. The template renders cleanly with empty values.

## Cover letter accuracy guard — CENTERPIECE

Cover letter content MUST come exclusively from `cv-<variant>.md`. No exceptions. **This is the single most important rule in this skill.**

- Never reference a target company's customer names, investor names, partnerships, or third-party companies as if the candidate has personal experience with them.
- Evaluation reports and company research contain target-company prospect lists (e.g., "[Target] customers include [BigCo, MidCo, SmallCo]"). **This is context about the prospect, not the candidate's background.** Do not write it as if the candidate has worked with those organizations.
- Acceptable: `At <my employer>, I built products serving <my employer's customers, from cv.md>.`
- Forbidden: `...the kind of <BigCo>-caliber organizations <Target> already serves.` (the candidate has not worked with BigCo.)

If you are not 100% certain a statement comes directly from `cv.md`, do not include it. The cost of a fabricated claim showing up in an interview is high; the cost of a slightly-less-flashy paragraph is low.

## Accuracy guardrails — DEFAULTS

- **Never invent** metrics, titles, dates, or experience not in `cv-<variant>.md`.
- **Never abbreviate** institution names without explicit instruction in `personal.local.md`. Default to full official names.
- See `personal.local.md` for candidate-specific framings.

## Language and formatting

- No em-dashes, no en-dashes, no double-dashes. Use periods, commas, colons, parentheses.
- No filler vocabulary: avoid `delve`, `unleash`, `harness`, `tapestry`, `navigate` (as metaphor), `leverage` (as verb), `robust`, `seamless`, `streamline`, `empower`, `bolster`, `foster`, `bespoke`, `holistic`, `multifaceted`, `crucial`, `vital`, `paramount`, `elevate`, `unveil`, `transformative`, `revolutionize`, `optimize` (use specific outcome instead), `end-to-end`, `best-in-class`, `cutting-edge`.
- No "It's not just X, it's Y" reframes.
- No "I'm thrilled / excited / passionate" boilerplate openings. Open with substance.
- English only.
- Use `<strong>` sparingly on key numbers in the body paragraph (e.g., `<strong>$11.2M retained</strong>`). Don't bold full sentences.

## Page format — MANDATORY

- Always US Letter (8.5in × 11in).
- Render with `--format=letter` (or omit, since letter is default). **Never** pass `--format=a4`.
- Zero Playwright margins. The template's `.page` div handles its own padding (0.45in × 0.6in).

## Section order

1. Header (name, teal rule, contact row)
2. Date + Addressee block
3. Salutation
4. Opening paragraph (2-3 sentences)
5. Body paragraph (3-5 sentences with proof points)
6. Closing paragraph (2-3 sentences)
7. Closing line + signature block + typed name + typed title

## Post-generation verification — ALWAYS RUN

Before reporting done:

1. **Font embedding** — generate-pdf.mjs output must show `Embedded font:` lines for each woff2 actually referenced. If any are missing, stop and fix.
2. **Page count = 1** — confirm against the script's reported page count. If 2 pages, run the 1-page enforcement loop.
3. **Three paragraphs present** — opening, body, closing. None merged or missing.
4. **Accuracy spot-check** — every claim in the body paragraph traces back to a sentence in `cv-<variant>.md`. If any sentence is from a research report or invented, rewrite.
5. **Banned-word scan** — grep the rendered HTML for any of the filler-vocabulary list above. If hits, rewrite.
6. **Closing details** — typed name matches `{{NAME}}`, typed title pulled from `personal.local.md`, signature image present if path configured.

Never report the PDF as done without all six checks.

## Report format

Reply with:

```
PDF: packages/renderer/output/cover-letter-<candidate>-<slug>-<date>.pdf
Pages: 1
Size: <N> KB
Variant: <generic|healthcare>
Proof points used:
  - <one-line: which 2-3 proof points landed in the body paragraph>
```

Keep the report under 8 lines. The PDF speaks for itself.
