# Playbook: u-journey-cmd-blast-radius

Falsifiable done predicate. `parity/evidence/blast-radius/pair-blast-radius-run-proof-1.json` exists with both Cursor and Pi `attemptId` values; each side has real PTY `identity.json` + `events.jsonl`; observations re-read screens, done markers, and any proof scripts and record that the reply reached certainty step 4 (ran a script or test against real code) or named an explicit cheaper stop with a certainty level, not a writeup-only narrative; report at `parity/briefs/reports/u-journey-cmd-blast-radius-report.md`; ledgers untouched; no commit; no fabricated pairs.

Rigor. High on run-proof evidence (tool runs, proof files under the fixture, done marker). Medium on exact risk wording (DRAFT acceptance).

## Phases

1. Scaffold held-out fixture `fixture-app/` (`src/ttl.js` immortal `ttl===0` contract, `CHANGE.diff` that flips zero-ttl to dead). Verify. Baseline copies under `fixture-baseline/`.
2. Write `parity/scripts/capture-blast-radius-run-proof.mjs` with residual-safe `/blast-radius` prompt and scorer for step-4 / cheaper-stop vs writeup-only. Verify. `--self-test` green; locked models.mdc digest check present.
3. Capture Cursor (`--cursor-only`). Verify. Attempt dir has screens, identity, events; rule digest unchanged.
4. Capture Pi (`--pi-only`). Verify. Same as Cursor; Pi session path retained when discoverable.
5. Score both sides from done markers, screens, proof artifacts, and Pi session tool order. Verify. Per-host verdict in `{run_proof, cheaper_stop, writeup_only, inconclusive}`.
6. Write pair JSON + report + decision-trail rows. Verify. Done predicate above holds on disk.

## Non-goals

- Editing `parity/mismatches.json`, `parity/requirements.json`, `parity/progress.md`, or family stubs.
- Committing.
- Repairing host product if either side stays writeup-only (honest fail / mismatch note only).
- Using Cursor as an implementation backend for Pi.

## Held-out candidate task (what the hosts see)

Candidate change in `CHANGE.diff` flips `ttl === 0` from immortal to expired. Invoked via `/blast-radius`. Agents must not be told this is a parity run-proof experiment.
