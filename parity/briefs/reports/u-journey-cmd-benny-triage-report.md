# u-journey-cmd-benny-triage report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, both fail-closed on incomplete Benny config). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `876cbcf4-ea8d-4276-9e9b-f0ec2a7da379` |
| pi | `5e2be54e-ec04-4238-a2d0-2fd622e87cc0` |

Pair. `parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Fail-closed on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=fail-closed reason=incomplete Benny config`. Settled screen. Product digest `6d25aaa55e…` unchanged. No Slack/tracker/reproduce chrome. |
| pi | **yes** | `STATUS=fail-closed reason=incomplete config: no slack actions, tracker adapter ops, or routing map`. Session tools are skill/config reads + done write only. Same product digest. |

Worker capture playbook. `parity/evidence/benny-triage/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Scaffolded `parity/evidence/benny-triage/fixture-app` from the benny-repro pack with triage-oriented incomplete config comment.
2. Wrote `PLAYBOOK.md` and `parity/scripts/capture-benny-triage-fail-closed.mjs` (self-test green).
3. `node parity/scripts/capture-benny-triage-fail-closed.mjs --cursor-only` (first attempt `73825615…`, fail-closed).
4. Restored Cursor `pstack-models.mdc` to locked digest after drift, then `--pi-only` (attempt `7ffda35d…`).
5. Tightened the reproduce observer after a PTY false positive on prompt/negation phrasing. Guarded the script so imports cannot re-enter capture.
6. A paired Cursor+Pi run produced the published attempt IDs above. Re-scored both from screens + `events.jsonl`. Re-read settled screens and identities.

## Deviations

1. Published pair is from a later paired capture after the scorer fix, not the first sequential Cursor-then-Pi attempts (those dirs are retained under `earlierAttemptsKept`).
2. Pre-Pi restore of drifted Cursor models.mdc from the Pi locked copy.
3. Trigger JSON and Slack thread were prompt-asserted, not live Slack. This journey only exercises incomplete-config fail-closed entry for triage.
4. Did not capture the valid-config positive path (one thread-only verdict).
5. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
6. Did not commit.

## Honest product gaps

1. Exact fail-closed reason strings differ by host wording. Behavior matches.
2. This is not a live Benny automation invoke with real Slack. It is an agent-driven skill start against a held-out incomplete config path (matches the scenario action input).
3. Requirement text also names the valid-config contract (one thread-only verdict, no reproduce-or-fix in triage). That positive path is still unverified by this pair.
4. Acceptance text for the fail-closed message remains DRAFT / host-dependent.
5. Initial raw Pi score flipped to `proceeded` until the observer stopped treating prompt-echoed `start reproduce-and-fix-issues` and "no reproduce-and-fix runs" as attempts. Product behavior on screen was already fail-closed.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `cmd-benny-triage-thread-only` evidence when ready. Keep `PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001` open until the valid-config thread-only path is also paired, or until the oracle freezes the incomplete-config negative path as sufficient.
2. Optionally capture a live-automation trigger path later.
