# Personal overlay for cover-letter-tailor

This file holds candidate-specific cover-letter rules. The base `SKILL.md` is generic. Copy this file to `personal.local.md` (gitignored) and customize.

```bash
cp .claude/skills/cover-letter-tailor/personal.example.md \
   .claude/skills/cover-letter-tailor/personal.local.md
```

When the cover-letter-tailor skill runs, it loads `personal.local.md` first and applies its rules on top of the generic SKILL.md defaults.

---

## Candidate identity

These overlay or override the values pulled from `config/profile.yml`.

- **Resume slug** (used in PDF filenames): `<candidate-slug>` (e.g., `david` for David Lovecchio)
- **LinkedIn display text**: `linkedin.com/in/<your-handle>`
- **Portfolio display text**: `<YourPortfolioDomain>.com`
- **Typed title** (under your typed name in the closing block): `<Your role> | <Specialty> | <YourDomain>.com` (e.g., `Product Leader | Applied AI | DavidGLovecchio.com`)

## Signature image (optional)

If you want a signature image rendered above your typed name in the closing block:

- **Signature image path**: `config/signature.png` (or wherever you keep it locally)
- The renderer auto-embeds it as a base64 data URI. The image should be a transparent PNG, roughly 200x60 px at 1x. Recommended height in CSS: 42px.
- If no signature is configured, the closing block renders without one (just the typed name and title). That's a perfectly normal cover letter.

## Addressee defaults

When the JD doesn't name a hiring manager, what to write in the salutation and addressee block.

- **Default addressee line 1**: `Hiring Team` (or `Recruiting Team`, `People Operations`, etc.)
- **Default salutation**: `Dear <Company> Hiring Team,`
- **Closing line**: `Thank you for your consideration,` (or `Best regards,`, `Warm regards,`, etc.)

## Tone preferences

Notes on the candidate's writing style for cover letters.

- **`<TONE NOTE>`**: e.g., "Lead with concrete metrics, not adjectives. The opening paragraph should anchor in one specific accomplishment within two sentences."
- **`<OPENING STYLE>`**: e.g., "Never start with 'I'm thrilled' or 'I'm excited'. Open with the role you're applying for and your single strongest credential."
- **`<CLOSING STYLE>`**: e.g., "Closing paragraph should name one specific reason this company is the fit (their domain, their stage, their problem) and a low-key invitation to talk."

## Personal accuracy guardrails (cover-letter-specific)

The base SKILL.md has the universal "content from cv.md only, no third-party customer borrowing" rule. Add candidate-specific examples here:

- **Acceptable**: `At <my employer>, I built products serving <my employer's documented customers from cv.md>.`
- **Forbidden**: `...the kind of <BigCo>-caliber organizations <Target> already serves.` (BigCo is from <Target>'s research report, not my background.)
- **`<YOUR_FRAMING>`**: e.g., "Always say 'I directly manage pods within an org' not 'I built the org' for the eVisit narrative."

## Vertical-specific tone (optional)

When the JD's vertical is healthcare, fintech, edtech, etc., apply additional rules here.

### Healthcare

- **Clinical-grade language**: phrases like "clinical-grade quality bar", "EHR/EMR-integrated workflows", "release discipline at the bar clinical software requires" are aligned with how candidates with eVisit/Epic/Cerner experience write. Use sparingly so it doesn't read as buzzword salad.
- **Compliance signals**: drop in `HIPAA / SOC 2 / HL7 / FHIR` only when the JD asks for them. Don't pad with all four.

### (Add other verticals as needed)
