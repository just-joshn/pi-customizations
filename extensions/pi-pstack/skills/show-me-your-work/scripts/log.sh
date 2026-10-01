#!/usr/bin/env bash
# Append a well-formed row to a show-me-your-work decision log (TSV).
# Usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>
set -euo pipefail

if [ "$#" -ne 6 ]; then
	printf 'usage: log.sh <logfile> <phase> <decision> <why> <evidence> <result>\n' >&2
	exit 1
fi

logfile="$1"
shift

logdir="$(dirname "$logfile")"
if [ -n "$logdir" ] && [ "$logdir" != "." ] && [ ! -d "$logdir" ]; then
	mkdir -p "$logdir"
fi

# Serialize writers so two first writers cannot both write the header. A lock
# older than ten seconds belongs to a killed writer and is taken over.
lockdir="$logfile.lock"
tries=0
until mkdir "$lockdir" 2>/dev/null; do
	tries=$((tries + 1))
	if [ "$tries" -gt 200 ]; then rmdir "$lockdir" 2>/dev/null || true; tries=0; fi
	sleep 0.05
done
trap 'rmdir "$lockdir" 2>/dev/null || true' EXIT

# Use `>>` here, never `>`. A network mount can fail this test for a log
# that exists. Then the cost is one stray header line, not the rows.
if [ ! -s "$logfile" ]; then
	printf 'ts\tphase\tdecision\twhy\tevidence\tresult\n' >> "$logfile"
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Strip tabs/newlines/CR so cells stay on one line, and prefix any cell
# whose first char a spreadsheet would parse as a formula (=, +, -, @)
# with a single quote. The skill expects this log to be read in
# spreadsheets, so attacker-controlled evidence (PR titles, filenames,
# generated text) must not become formula execution when a reviewer
# opens the file.
clean() {
	local v
	v=$(printf '%s' "$1" | tr '\t\n\r' '   ')
	case "${v#"${v%%[![:space:]]*}"}" in
		=*|+*|-*|@*) printf "'%s" "$v" ;;
		*) printf '%s' "$v" ;;
	esac
}
printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
	"$ts" "$(clean "$1")" "$(clean "$2")" "$(clean "$3")" "$(clean "$4")" "$(clean "$5")" \
	>> "$logfile"
