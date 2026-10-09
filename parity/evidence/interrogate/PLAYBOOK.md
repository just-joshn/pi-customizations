# Interrogate no-autoapply capture playbook

## Done

Pair JSON with Cursor+Pi attempt IDs. Settled screens or assistant text show a synthesized verdict (findings reported). Product `src/total.js` digests identical before/after on both hosts (no auto-apply), or honest fail/mismatch. Honest deltas. Ledgers untouched.

## Units

1. Seed contested fixture under `fixture-app/src/total.js`.
2. Capture script hashes product before/after and scores verdict signals on real PTY.
3. Run `--cursor-only`, then `--pi-only` (shared fixture).
4. Write pair JSON + worker report. No ledger edits. No commit.

## Prompt shape

`/interrogate` on `src/total.js` only. Present synthesized verdict. Write settle marker to `fixture-out/<side>/done.txt`. Do not hand the agent a finished verdict.
