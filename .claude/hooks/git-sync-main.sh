#!/usr/bin/env bash
# SessionStart hook: keep local main in sync with origin/main when it's safe.
#
# - Fetches origin (silent on success)
# - Fast-forwards local main IF currently on main AND working tree is clean
# - Warns if local main is ahead of origin/main (usually an unpushed commit
#   that should go through a PR per CLAUDE.md Workflow Rules)
# - Never blocks the session: exits 0 even on git failure
#
# Designed to be cheap and silent. Output only when there's something the
# user should know.

set +e
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

git fetch origin --quiet 2>/dev/null

BRANCH=$(git branch --show-current 2>/dev/null)
[ -n "$BRANCH" ] || exit 0

# Only attempt to auto-sync the canonical main branch.
if [ "$BRANCH" = "main" ]; then
  if git diff --quiet && git diff --cached --quiet; then
    BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null)
    AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null)
    if [ "${AHEAD:-0}" = "0" ] && [ "${BEHIND:-0}" != "0" ]; then
      git merge --ff-only origin/main --quiet 2>/dev/null \
        && echo "[git] synced main: pulled $BEHIND commit(s) from origin"
    elif [ "${AHEAD:-0}" != "0" ]; then
      echo "[git] local main is $AHEAD commit(s) ahead of origin/main — push or open a PR"
    fi
  else
    echo "[git] on main with uncommitted changes — auto-sync skipped"
  fi
else
  # On a feature branch: just inform if origin/main moved relative to where
  # this branch was last cut. Useful signal that a rebase may be due.
  BASE_BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null)
  if [ "${BASE_BEHIND:-0}" != "0" ] && [ "${BASE_BEHIND:-0}" -gt 5 ]; then
    echo "[git] $BRANCH is $BASE_BEHIND commits behind origin/main — consider rebasing"
  fi
fi

exit 0
