#!/usr/bin/env bash
# quickfill — apply many pinchtab fills in one shot.
#
# Usage:
#   quickfill '[{"ref":"e3","value":"Vinicius"},{"ref":"#email","value":"x@y.com"}]'
#   quickfill path/to/pairs.json
#
# Input is a JSON array of {ref, value} objects. "ref" is any pinchtab
# selector (e3, #id, text:Submit, find:..., etc).  Prints one line per fill
# with its status ("ok" | "err: <msg>") and exits 0 if every fill succeeds.

set -o pipefail

input="${1:-}"
if [[ -z "$input" ]]; then
  echo "quickfill: missing input (JSON string or file path)" >&2
  exit 2
fi

# If argument is a readable file, use its contents; otherwise treat as inline JSON
if [[ -f "$input" ]]; then
  payload="$(cat "$input")"
else
  payload="$input"
fi

# Extract ref|value pairs via jq: one "ref<TAB>value" per line
pairs="$(printf '%s' "$payload" | jq -r '.[] | "\(.ref)\t\(.value)"')" || {
  echo "quickfill: invalid JSON input" >&2
  exit 2
}

ok=0
fail=0
while IFS=$'\t' read -r ref value; do
  [[ -z "$ref" ]] && continue
  if out="$(pinchtab fill "$ref" "$value" 2>&1)"; then
    echo "$ref: ok"
    ok=$((ok + 1))
  else
    echo "$ref: err: ${out//$'\n'/ }"
    fail=$((fail + 1))
  fi
done <<< "$pairs"

echo "quickfill: $ok ok, $fail failed"
[[ $fail -eq 0 ]]
