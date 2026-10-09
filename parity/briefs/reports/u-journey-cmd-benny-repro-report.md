# u-journey-cmd-benny-repro report

## Status

**pass** for the capture brief (linked Cursor+Pi pair on real PTY, both fail-closed). Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `e3e5e224-5d6a-4e9d-ab62-064386174fdc` |
| pi | `85ff157c-90dc-43dd-927f-e2a8b32488bf` |

Pair. `parity/evidence/benny-repro/pair-benny-repro-fail-closed-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Fail-closed on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes** | `STATUS=fail-closed reason=incomplete config missing control adapter and feature map`. Settled screen. Product digest `6d25aaa55e…` unchanged. No UI/PR/product-edit chrome. |
| pi | **yes** | `STATUS=fail-closed reason=config missing control adapter, feature map, and Slack actions`. Session tools are bash reads + done write only. Same product digest. Assistant states no repro, Slack, or code changes. |

Worker capture playbook. `parity/evidence/benny-repro/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Restored Cursor `pstack-models.mdc` to locked digest `sha256:2b6b4668…6004` (had drifted to `sha256:c839b86e…`).
2. Seeded fixture with Benny pack + incomplete `.upstream/benny/configuration.yaml` + `src/app.js`.
3. Wrote `PLAYBOOK.md` and `parity/scripts/capture-benny-repro-fail-closed.mjs` (self-test green).
4. `node parity/scripts/capture-benny-repro-fail-closed.mjs --cursor-only` (~28s).
5. `node parity/scripts/capture-benny-repro-fail-closed.mjs --pi-only` (~19s).
6. Re-read settled screens, done markers, product digest, attempt `identity.json` + `events.jsonl`.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Pre-capture restore of drifted Cursor models.mdc from the Pi locked copy.
3. Cursor also Read the worker `PLAYBOOK.md` under `parity/evidence/benny-repro/` (harness curiosity, not product edit).
4. Pi read the skill via `bash` rather than the `read` tool. Engagement still measured.
5. Triage marker and Slack thread were prompt-asserted, not live Slack. This journey only exercises config fail-closed entry.
6. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
7. Did not commit.

## Honest product gaps

1. Exact fail-closed reason strings differ by host wording. Behavior matches.
2. This is not a live Benny automation invoke with real Slack. It is an agent-driven skill start against a held-out incomplete config path (matches the scenario fixture description).
3. Cursor reading `PLAYBOOK.md` shows the evidence tree is visible from the fixture cwd parent walk. Future fixtures may want the playbook outside the agent-visible tree.
4. Acceptance text for the fail-closed message remains DRAFT / host-dependent.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `cmd-benny-repro-fail-closed` evidence when ready. Close `PSTACK-CMD-BENNY-REPRO-FAIL-CLOSED-001` when oracle freeze allows.
2. Optionally capture a live-automation trigger path later. This pair covers the incomplete-config fail-closed entry only.
