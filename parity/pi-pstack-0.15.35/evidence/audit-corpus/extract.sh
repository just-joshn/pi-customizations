#!/usr/bin/env bash
# Extract candidate Cursor-host-dependent references from the pi-pstack corpus.
#
#   ./extract.sh corpus            # shipped corpus: extensions/pi-pstack/{skills,agents,docs}
#   ./extract.sh upstream          # upstream pstack @ pin, same dirs
#   ./extract.sh changed           # only files changed between BASE and PIN upstream
#   ./extract.sh corpus summary    # counts per concept
#
# Output TSV: concept <TAB> file:line <TAB> text
set -uo pipefail

PKG=${PKG:-/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack}
UPSTREAM=${UPSTREAM:-/tmp/cursor-plugins}
BASE=${BASE:-519d36a}
PIN=${PIN:-ab1f702}
HERE=$(cd "$(dirname "$0")" && pwd)
PATTERNS="$HERE/patterns.tsv"
MODE=${1:-corpus}
FORMAT=${2:-tsv}

extract_upstream() { # $1 = ref, $2 = dest ; paths = pstack dirs + cursor-team-kit skills vendored
  local ref=$1 dest=$2
  rm -rf "$dest"; mkdir -p "$dest"
  git -C "$UPSTREAM" archive "$ref" \
    pstack/skills pstack/agents pstack/docs \
    cursor-team-kit/skills/deslop cursor-team-kit/skills/control-cli cursor-team-kit/skills/control-ui 2>/dev/null \
    | tar -x -C "$dest"
}

case "$MODE" in
  corpus)
    ROOT=$PKG
    PATHS=("$PKG/skills" "$PKG/agents" "$PKG/docs")
    ;;
  upstream)
    ROOT=$HERE/src-upstream
    extract_upstream "$PIN" "$ROOT"
    PATHS=("$ROOT")
    ;;
  changed)
    ROOT=$HERE/src-changed
    rm -rf "$ROOT"; mkdir -p "$ROOT"
    # Files touched between BASE and PIN, materialized at PIN so line numbers match the pin.
    git -C "$UPSTREAM" diff --name-only "$BASE" "$PIN" -- pstack cursor-team-kit \
      | while read -r f; do
          [ -f "$UPSTREAM/$f" ] || continue
          git -C "$UPSTREAM" show "$PIN:$f" > "$ROOT/$(echo "$f" | tr '/' '_')" 2>/dev/null
        done
    PATHS=("$ROOT")
    ;;
  *)
    echo "usage: $0 {corpus|upstream|changed} [tsv|summary]" >&2; exit 2;;
esac

# Skip generated/vendor noise inside the package.
EXcludes=(--glob '!node_modules/**' --glob '!coverage/**' --glob '!test/**')

while IFS=$'\t' read -r concept pattern; do
  [ -z "${concept:-}" ] && continue
  case "$concept" in \#*) continue;; esac
  rg --no-heading --line-number --with-filename --pcre2 --color never \
     -e "$pattern" "${EXcludes[@]}" "${PATHS[@]}" 2>/dev/null \
  | while IFS=: read -r file line text; do
      printf '%s\t%s:%s\t%s\n' "$concept" "${file#"$ROOT"/}" "$line" "$(printf '%s' "$text" | sed 's/^[[:space:]]*//' | cut -c1-220)"
    done
done < "$PATTERNS" > "$HERE/out-$MODE.tsv"

if [ "$FORMAT" = summary ]; then
  cut -f1 "$HERE/out-$MODE.tsv" | sort | uniq -c | sort -rn
else
  cat "$HERE/out-$MODE.tsv"
fi
