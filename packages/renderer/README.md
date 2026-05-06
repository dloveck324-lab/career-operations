# @career-operations/renderer

HTML to PDF rendering for tailored resumes and cover letters. Outputs ATS-parseable PDFs (real text layer, not embedded images) using Playwright headless Chromium.

## What it does

Takes a fully-rendered HTML file (template with all placeholders already filled in by the Claude `resume-tailor` skill) and produces a one-page PDF that:

- Has a real, selectable, parseable text layer (`pdftotext` works, ATS parsers work).
- Embeds custom fonts as base64 data URIs (avoids Playwright's flaky local font loading).
- Normalizes ATS-hostile Unicode (em-dashes, smart quotes, NBSP, zero-width chars) to plain ASCII.
- Uses `screen` media in `page.pdf()` to dodge a Chromium bug where print media swaps glyph metrics mid-render and produces "mumbled" text.

## Layout

```
packages/renderer/
├── package.json
├── README.md
├── .gitignore                     keeps output/, *.pdf, .render-trigger out of git
├── generate-pdf.mjs               the renderer (CLI script, also importable)
├── templates/
│   └── resume.html                source template with {{TOKEN}} placeholders
├── fonts/
│   ├── space-grotesk-*.woff2      8 files: latin + latin-ext, weights 400/700
│   └── dm-sans-*.woff2            8 files: latin + latin-ext, weights 400-700
└── scripts/
    └── watch-and-render.sh        dev watcher that auto-renders on template change
```

## CLI usage

```bash
# Direct invocation
node packages/renderer/generate-pdf.mjs \
  /path/to/tailored.html \
  /path/to/output.pdf \
  --format=letter

# Or via npm script (from repo root)
npm run --workspace=@career-operations/renderer render -- \
  /path/to/tailored.html \
  /path/to/output.pdf
```

Format options: `letter` (default) or `a4`. Output path is created if missing.

## How the Claude skill uses it

The `resume-tailor` skill (at `.claude/skills/resume-tailor/SKILL.md`) follows this contract:

1. Reads `config/cv-<variant>.md` (CV markdown) and `config/profile.yml`.
2. Reads the JD (URL or pasted text).
3. Generates a fully-filled HTML by combining `packages/renderer/templates/resume.html` with tailored content.
4. Writes the filled HTML to `packages/renderer/templates/resume-tailored-<slug>.html` or to `/tmp/`.
5. Calls `node packages/renderer/generate-pdf.mjs <input.html> <output.pdf>`.
6. Reports back the PDF path and page count.

The skill handles tailoring (keyword extraction, bullet rewrite, page-fit). The renderer handles only HTML to PDF.

## Watcher mode

For sessions where you want auto-rendering as Claude updates a template:

```bash
./packages/renderer/scripts/watch-and-render.sh
```

Leave that running in a Terminal tab. When Claude writes a filename to `packages/renderer/.render-trigger`, the watcher renders the matching template into `packages/renderer/output/`.

## Why these specific workarounds

Two non-obvious things in `generate-pdf.mjs` are intentional, not vestigial:

1. **Font base64 embedding.** Playwright's local-file font loading is flaky in headless mode and produces blank PDFs intermittently. Inlining fonts as `data:font/woff2;base64,...` URIs sidesteps the loader entirely.
2. **`emulateMedia('screen')` before `page.pdf()`.** `page.pdf()` defaults to print media. Print media in Chromium has historically caused the renderer to swap glyph metrics mid-call, producing wrong inter-glyph advance widths (text appears with broken kerning, the "mumbled text" bug). Screen media uses the metrics the live preview uses.

If you ever see blank PDFs or weird kerning regress, check those two paths first.

## Dependencies

- `playwright` ^1.59.1 (Chromium bundled). Install with `npm install --workspace=@career-operations/renderer`.
- Node 20 or newer (matches the rest of the monorepo).

## What this package does NOT do

- It does not write the cover letter template (the existing cover-letter HTML files in the legacy worktree are filled artifacts, not skeletons). A clean `cover-letter.html` template lands in a follow-up commit.
- It does not run the tailoring pass (that's the `resume-tailor` skill's job).
- It does not host an HTTP endpoint. If the dashboard ever needs to trigger renders via the UI, the `apps/server` package would import from this package and add a route.
