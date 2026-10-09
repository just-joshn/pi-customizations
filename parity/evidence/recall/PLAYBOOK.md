# Recall capsule capture playbook

## Done

Pair JSON with Cursor+Pi attempt IDs. Settled screens or `brief.md` scored against capsule ≤5, tagged threads, problems ≤5, single next move. Honest deltas. Ledgers untouched.

## Units

1. Seed held-out fixture under `fixture-app/seed/` (transcripts + shared-record).
2. Capture script scores real PTY + written brief.
3. Run `--cursor-only`, then `--pi-only`.
4. Write pair JSON + worker report. No ledger edits. No commit.

## Prompt shape

`/recall` on hello-cli verification. Scope is this fixture cwd, last 7 days, mine only `seed/`. Do not hand the agent a finished capsule.
