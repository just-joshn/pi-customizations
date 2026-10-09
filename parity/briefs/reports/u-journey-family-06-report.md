# u-journey-family-06 report

## Status

**pass** for the capture brief. First linked Cursor+Pi pair for journey family 06 captured on real PTY. `/swarm` N=2 partition wrote isolated `WORKER-A` / `WORKER-B` files on both hosts and each parent returned one rolled-up PASS report. Fixture digests match. Honest host deltas recorded. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `1aaf5610-1b40-4bc6-b265-6249dca1d6e1` |
| pi | `408c6db6-2522-4fec-99f9-e76911bb21cf` |

Pair. `parity/evidence/swarm/pair-swarm-n2-isolated-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (both sides `ruleUnchanged: true`, afterDigest identical)

## Observed fan-out

Prompt on both sides. `/swarm N=2 partition` with absolute paths under `parity/evidence/swarm/fixture-out/<side>/{a,b}.txt`.

### Cursor (reference)

Measured from `screen-03-fanout-signal.txt` and `screen-04-settled.txt`, plus on-disk files.

1. Todo list showed Frame, Fan out Worker A and Worker B, Drain, Return rolled-up report.
2. Settled screen listed `a.txt` and `b.txt`, then `Swarm report: PASS` with both absolute paths and `WORKER-A` / `WORKER-B` evidence.
3. Issues none. Gaps/dropouts none.
4. Files on disk. `WORKER-A` and `WORKER-B` exactly. No collision.

### Pi (adaptation)

Measured from `screen-03-fanout-signal.txt` and `screen-04-settled.txt`, plus on-disk files.

1. Mid screen showed `[skill] swarm` and TodoWrite while Working.
2. Settled screen. `Swarm report: PASS (2 of 2 slices)` table with both absolute paths and `cat -A` evidence `WORKER-A$` / `WORKER-B$`.
3. Parent said workers ran locally on the parent model (`inherit-parent`), not remote.
4. Parent said it did not re-check the directory itself. On-disk files still match the contract.
5. A late `system_notification` reported worker-a idle after the rollup was already printed.
6. Files on disk. `WORKER-A` and `WORKER-B` exactly. No collision.

## Isolation and rollup

| Check | Cursor | Pi |
| --- | --- | --- |
| Fan-out started (N=2) | yes (todo Fan out) | yes (`[skill] swarm` + workers) |
| `a.txt` = WORKER-A | yes | yes |
| `b.txt` = WORKER-B | yes | yes |
| Shared-write collision | no | no |
| Single rolled-up PASS | yes | yes |
| Both paths in rollup | yes | yes |

## Commands run

1. Confirmed locked fixture digest on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote `parity/scripts/capture-swarm-fanout.mjs`.
3. Ran `--cursor-only`, then `--pi-only`.
4. Re-read settled screens, identities, rule-after digests, fixture-out files, and Pi session `2026-10-08T18-58-43-663Z_01a11ce1-d14e-744c-be30-3552428f62a0.jsonl`.

## Deviations

1. Orphan Cursor attempt dir `b5707e63-ce83-4947-9ce7-e259b4cb718b` present under evidence. Not used for the linked pair. Recorded in pair JSON `discardedAttempts`.
2. Pi parent prose did not re-`cat` the write root after workers finished. Isolation for this pair is taken from on-disk files and the rollup table, not from that self-report.
3. Model identity chrome differs. Cursor Auto vs Pi `claude-sonnet-5-5 • medium`. Not silently reconciled.
4. Family stub also lists arena/architect/interrogate/reflect/panel-fanout. This pair only covers the minimal swarm fan-out slice.
5. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
6. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge this pair into `journey-family-06-multiworker-designs-reviews` evidencePaths and `cmd-swarm-fanout` execution.
2. Expand family 06 to failure and cancellation pairs next.
3. Decide whether Pi local-only workers (no remote) need a host binding note for cloud fan-out wording in the swarm skill.
