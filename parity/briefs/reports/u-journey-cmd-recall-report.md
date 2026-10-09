# u-journey-cmd-recall report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both hosts mined `seed/` only and wrote a contract-shaped brief (capsule ≤5, tagged threads, problems ≤5, single next move). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `25c1bcca-e7ad-41b3-80dd-1fbac71066ec` |
| pi | `ed0f279b-00a6-4934-8142-5859899cf832` |

Pair. `parity/evidence/recall/pair-recall-capsule-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Contract held?

| Side | Capsule ≤5 | Tagged threads | Problems ≤5 | Single next move | Verdict |
| --- | --- | --- | --- | --- | --- |
| cursor | 5 | 4/4 tagged | 5 | 1 | **yes** (`fixture-out/cursor/brief.md`) |
| pi | 5 | 4/4 tagged | 5 | 1 | **yes** (`fixture-out/pi/brief.md`) |

Oracle. Written `brief.md` on each side. Settled screens were re-read. Pi screen shows the four sections. Cursor screen wraps mid-line so the automated screen scorer is not trusted over the brief file.

## Commands run

1. Confirmed locked models.mdc digest on both host rule paths (`sha256:2b6b4668…6004`).
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Seeded `parity/evidence/recall/fixture-app/seed/{transcripts,shared-record}` and wrote `PLAYBOOK.md` plus `parity/scripts/capture-recall-capsule.mjs`.
4. `node parity/scripts/capture-recall-capsule.mjs --cursor-only` (~54s).
5. Fixed scorer heading regex (`#{1,3}`) after a blank-line false cut on Next move; re-scored Cursor `brief.md` to `contractHeld=true`.
6. `node parity/scripts/capture-recall-capsule.mjs --pi-only` (~36s).
7. Re-read both briefs, Pi settled screen, Pi session tool order, Cursor observations.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Held-out corpus is `seed/` inside the fixture, not host-global transcript dirs. Prompt locked scope to that path.
3. Automated PTY screenScore can fail on wrap or missing `##` hashes even when the brief holds. Pair records brief.md as the scored artifact.
4. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge `recall-capsule-1` into family-13 / `cmd-recall-capsule` evidence and close PSTACK-CMD-RECALL-CAPSULE-001 when ready.
2. Optionally harden the screen scorer for non-`##` Capsule/Threads headings so PTY-only checks match brief.md.
3. Optionally recapture with live git/gh verify step if a later requirement needs that slice.
