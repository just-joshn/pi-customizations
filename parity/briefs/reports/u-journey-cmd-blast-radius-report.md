# u-journey-cmd-blast-radius report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, both run-proof at certainty step 4). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `10de693f-5087-438e-bd91-5cd266fc75e3` |
| pi | `25fbb44d-c4bd-40ea-a4e5-c46f62166074` |

Pair. `parity/evidence/blast-radius/pair-blast-radius-run-proof-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Run-proof on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** (`run_proof`) | `PROOF=step4 certainty=4 fact=ttl0-immortal-sessions-purged`. Settled screen cites `prove-unsafe.mjs` against real modules. PTY `ranCode: true`. |
| pi | **yes** (`run_proof`) | `PROOF=step4 certainty=4` with immortal-session purge fact. Session `toolOrder` includes `bash(run-code)`. Screen and PTY both show code run. Retained `retained-proofs/prove-unsafe.mjs`. |

Worker capture playbook. `parity/evidence/blast-radius/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Confirmed locked `pstack-models.mdc` digest `sha256:2b6b4668…6004` on Cursor and Pi sides.
2. Seeded fixture with `src/ttl.js` immortal `ttl===0` contract and `CHANGE.diff` flipping zero-ttl to dead.
3. Wrote `PLAYBOOK.md` and `parity/scripts/capture-blast-radius-run-proof.mjs` (self-test green).
4. `node parity/scripts/capture-blast-radius-run-proof.mjs --cursor-only` (~59s).
5. `node parity/scripts/capture-blast-radius-run-proof.mjs --pi-only` (~24s).
6. Re-read settled screens, done markers, attempt `identity.json` + `events.jsonl`, Pi session tool order.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Harness `proofArtifacts` filter only watches `proofs/`, `scripts/`, `test/`. Both hosts wrote `prove-unsafe.mjs` at the fixture cwd root, so the filter stayed empty. Run evidence still came from PTY/session.
3. Pi leftover `prove-unsafe.mjs` was copied to `retained-proofs/` and removed from the fixture after scoring.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
5. Did not commit.
6. Cross-model show-me-your-work Attention review skipped. This worker is a poteto-agent subagent and must not spawn further subagents.

## Honest product gaps

1. Exact `PROOF=` fact strings differ by host wording. Behavior matches (step 4, change unsafe).
2. Acceptance text for the certainty ladder remains DRAFT / judgmental on when step 5 is required versus step 4.
3. Cursor screen final dump did not retain the `node` command line after settle (`screen.ranCode` false) while PTY bytes still showed the run.
4. This journey proves run-proof behavior on a held-out fixture change. It is not a live PR or running-app (step 5) reproduction.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-10 / `cmd-blast-radius-run-proof` evidence when ready. Close `PSTACK-CMD-BLAST-RADIUS-RUN-PROOF-001` when oracle freeze allows.
2. Optionally widen the capture artifact filter to cwd-root `prove-*.mjs` so leftover proof scripts are scored as on-disk artifacts without relying on PTY alone.
