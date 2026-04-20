# Native JS dialog handling

Native `alert()`, `confirm()`, `prompt()`, and `beforeunload` freeze the page's JS thread until resolved. PinchTab commands will hang, return stale output, or silently fail while one is open.

## Symptoms that a dialog is blocking you

- `pinchtab snap -i -c` returns a snapshot that looks identical to the prior one (stale).
- `pinchtab click ...` / `pinchtab fill ...` report success but `pinchtab text` shows no change.
- A command hangs past its normal response time, or errors with a timeout.
- Especially likely right after:
  - Clicking Back / Cancel / "Start Over" buttons.
  - Clearing or changing fields that trigger `beforeunload`.
  - Clicking anything on a draft-aware form.

## Detecting a dialog

Run the dialog command with no arguments to probe for a pending dialog:

```
pinchtab dialog
```

If a dialog is open, this command interacts with it (verified: `pinchtab dialog --help` exposes only `-h, --help` — no accept/dismiss/text flags on this installation). Also useful as a sanity probe:

```
pinchtab eval "document.title"
```

If `eval` hangs or comes back stale, assume a dialog is pending and run `pinchtab dialog`.

## Dismissing a dialog

Invoke:

```
pinchtab dialog
```

This resolves the pending dialog. After it returns, re-run `pinchtab snap -i -c` and verify the page is responsive (snapshot should differ, or a new click should register). Then resume the current pass.

## Don't accept unexpected confirms

If a `confirm()` pops up and you did not initiate an action that would warrant it — e.g. "Are you sure you want to submit?" — you must NOT let it proceed. We never submit. Handle the dialog via `pinchtab dialog`, re-snap, and re-evaluate what you just did. If your previous action would have submitted the form, treat that step as an error, add a note to `errors`, and do not retry it.

## `beforeunload` during navigation

`beforeunload` fires when the page thinks you're navigating away with unsaved changes. During autofill you should not be leaving the form, so treat this as a sign something went sideways (e.g. a stray click on a logo link). Handle it with `pinchtab dialog`, then re-snap to confirm you're still on the form.

## Proactive check

If anything seems stuck for more than one retry — a click doesn't register, a fill doesn't update the field, a snap looks frozen — run `pinchtab dialog` once before giving up on the step. It's cheap and catches the most common silent-freeze cause.

### Example flow

```
pinchtab click "Next"
pinchtab snap -i -c        # snapshot looks identical to before
pinchtab dialog            # handles the pending confirm()
pinchtab snap -i -c        # now shows the next step
```
