# Reflect trigger capture playbook

## Done

Pair JSON with Cursor+Pi attempt IDs. Both hosts show `/reflect` activation plus multi-agent review evidence (tooling / judgment / divergent fan-out, synthesizer Accepted/Rejected/Backlog), or an honest fail/mismatch. Real PTY both sides. Honest deltas. Ledgers untouched.

## Units

1. Seed fixture under `fixture-app` (broken `clamp` + empty NOTES).
2. Capture script runs a substantive turn, then `/reflect`, scores spawn/review on PTY and Pi session.
3. Run `--cursor-only`, then `--pi-only`.
4. Write pair JSON + worker report. No ledger edits. No commit.

## Prompt shape

Turn 1 fixes `src/clamp.js` and writes a boundary note. Turn 2 is `/reflect` with present-only synthesizer output and a `done.txt` settle marker. Do not hand the agent finished review text.
