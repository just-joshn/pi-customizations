#!/usr/bin/env bash
# Capture commands and their real exit status without inheriting shell tracing.
set -u
if [[ $# -lt 3 ]]; then
  echo 'usage: run-command.sh LOG WORKING_DIRECTORY COMMAND' >&2
  exit 2
fi
log=$1
cwd=$2
command=$3
mkdir -p "$(dirname "$log")"
(
  printf 'started_utc: '; date -u +%Y-%m-%dT%H:%M:%SZ
  printf 'cwd: %s\ncommand: %s\n\n' "$cwd" "$command"
  (cd "$cwd" && bash -o pipefail -c "$command")
  status=$?
  printf '\nexit_code: %s\nfinished_utc: ' "$status"
  date -u +%Y-%m-%dT%H:%M:%SZ
  exit "$status"
) >"$log" 2>&1
status=$?
cat "$log"
exit "$status"
