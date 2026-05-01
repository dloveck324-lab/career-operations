#!/usr/bin/env bash
# SessionStart hook: keep local main in sync with origin/main when it's safe,
# and clean up local feature branches whose PRs have been merged on GitHub.
#
# - Fetches origin (silent on success)
# - Fast-forwards local main IF currently on main AND working tree is clean
# - Warns if local main is ahead of origin/main (usually an unpushed commit
#   that should go through a PR per CLAUDE.md Workflow Rules)
# - For every other local branch: if `gh` CLI is available and a merged PR
#   exists with that branch as head, deletes the local branch. Branches
#   without a merged PR are NEVER touched (active work, abandoned work,
#   closed-without-merge PRs, branches with no PR — all left alone).
# - Never blocks the session: exits 0 even on git failure

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

# Auto-cleanup of merged feature branches. The trigger is GitHub merge
# state (gh pr list --state merged --head <branch>) — NOT local
# reachability. This is deliberate: squash-merge PRs produce a different
# commit on main, so `git branch --merged main` would never list them
# even though the work has shipped. Trusting GitHub catches that case.
#
# Branches WITHOUT a merged PR are never touched, including:
# - active work-in-progress (no PR yet, or open PR)
# - PRs that were closed without merging
# - branches without any PR at all
if command -v gh >/dev/null 2>&1; then
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    [ "$b" = "main" ] && continue
    [ "$b" = "$BRANCH" ] && continue   # never delete the checked-out branch
    merged_count=$(gh pr list --state merged --head "$b" --limit 1 --json number 2>/dev/null \
      | grep -c '"number"')
    if [ "${merged_count:-0}" != "0" ]; then
      git branch -D "$b" >/dev/null 2>&1 \
        && echo "[git] cleaned up merged branch: $b"
    fi
  done < <(git branch --format='%(refname:short)')
fi

exit 0
