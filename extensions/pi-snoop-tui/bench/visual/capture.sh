#!/usr/bin/env bash
# usage: capture.sh <label> <cols> <rows> [pi args...]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
label=$1 cols=$2 rows=$3; shift 3
out="$here/out"; mkdir -p "$out"
sock="${TMPDIR:-/tmp}/snoop-cap.sock"
sess="snoop-$label-$$"
work="$(mktemp -d "${TMPDIR:-/tmp}/snoop-capture.XXXXXX")"
if [[ -n "${FIXTURE:-}" ]]; then
  cp "$FIXTURE" "$work/s.jsonl"
else
  python3 "$here/mockup-fixture.py" "$work/s.jsonl" "$PWD"
fi
tmux -S "$sock" new-session -d -s "$sess" -x "$cols" -y "$rows" -- env COLORTERM=truecolor pi "$@" --session "$work/s.jsonl"
prev=""; stable=0
for _ in $(seq 1 80); do
  sleep 0.25
  cur="$(tmux -S "$sock" capture-pane -p -e -t "$sess")"
  if [[ "$cur" == "$prev" && -n "$cur" ]]; then stable=$((stable+1)); [[ $stable -ge 4 ]] && break; else stable=0; fi
  prev="$cur"
done
printf '%s\n' "$cur" > "$out/$label.ansi"
tmux -S "$sock" capture-pane -p -t "$sess" > "$out/$label.txt"
if [[ -n "${KEYS:-}" ]]; then
  tmux -S "$sock" send-keys -t "$sess" $KEYS; sleep 1.5
  tmux -S "$sock" capture-pane -p -e -t "$sess" > "$out/$label-keys.ansi"
  uv run -q --with pillow python "$here/ansi2png.py" "$out/$label-keys.ansi" "$out/$label-keys.png"
fi
tmux -S "$sock" kill-session -t "$sess"
rm -rf "$work"
uv run -q --with pillow python "$here/ansi2png.py" "$out/$label.ansi" "$out/$label.png"
echo "$out/$label.png"
