# File uploads

## When this applies

Resume PDF, cover letter file, portfolio PDF, transcripts — any `<input type="file">` on the form.

The invocation prompt provides a `Resume PDF path:` line right below the section header. If the path is `not-configured` (or empty), DO NOT upload anything: add the field label to `skipped` with reason `no-resume-path-configured` and move on. Never invent a path.

## Finding the file input

`pinchtab snap -i -c` lists interactive elements with refs (e.g. `e12`) and a role like `file input` or a nearby label like "Resume / CV". You can also locate it with:

```
pinchtab find "resume upload"
```

Note the CSS attributes (`name`, `id`, `data-*`) — you'll need a selector, not a snap ref, for the upload command.

## The upload command

Exact syntax (verified flags: only `-s, --selector`):

```
pinchtab upload <absolute_path> --selector <css_selector>
```

Selector preference (most → least specific):

1. `input[type=file][name="resume"]`
2. `input[type=file][id*="resume"]`
3. `input[type=file]` (only if exactly one file input exists on the page)

Do NOT pass a `pinchtab snap` ref (e.g. `e12`) — this command requires a CSS selector. The path must be absolute.

### Example

```
pinchtab upload /Users/jane/cv/jane-resume.pdf --selector 'input[type=file][name="resume"]'
```

## Verification

After the command returns, confirm the upload took:

```
pinchtab snap -i -c
```

or

```
pinchtab text
```

Most forms render the filename next to the input ("jane-resume.pdf ✓"). If the snapshot still shows "No file chosen" or "Drag file here", the upload failed — retry once with a broader selector, then skip with reason `upload-failed`.

## Multiple file inputs

If the form has Resume + Cover Letter + Portfolio:

- Upload the resume to the input labeled "Resume" / "CV" / "Curriculum Vitae".
- Skip the cover letter file input — the invocation prompt currently does not provide a distinct cover-letter path. Add the cover letter field to `skipped` with reason `no-cover-letter-file-configured`.
- Skip portfolio/transcript file inputs the same way unless a dedicated path is provided.

## Cover letter TEXT areas (not uploads)

A large `<textarea>` asking for a cover letter is NOT a file upload. Fill it as an open-ended Pass 4 answer grounded in the CV + JD, and count it in `suggestions` (not `filled`).

## Counting uploads

Each successful `pinchtab upload` counts in `filled`, NOT in `suggestions` — you supplied a pre-existing file, you did not generate content.
