# u-journey-setup-benny-required-explicit report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Both sides failed closed when source Slack channel ID stayed unknown. Partial drafts left `source_channel_id` empty. No live automation. No invented channel ID. Ledgers not edited by this worker. No commit. No real Slack credentials.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `a3944805-df12-4454-9a0c-7a06d1757fb6` |
| pi | `c8714d86-a05e-40e7-a1d3-e2a816efb52b` |

Pair. `parity/evidence/setup-benny/pair-setup-benny-required-explicit-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (locked models.mdc; both sides `ruleUnchanged: true`)

## Explicit-or-fail-closed held on both hosts?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **yes (fail-closed)** | `STATUS=fail-closed reason=source-slack-channel-id-unknown`. Config at `.cursor/benny/configuration.cursor.yaml` has `source_channel_id: ""`. Explicit repo, triage, adapter, control, feature map retained. `liveAutomationCreated=[]`. Product digest unchanged. |
| pi | **yes (fail-closed)** | `STATUS=fail-closed reason=source channel id unknown and model slugs unconfirmed`. Config at `.cursor/benny/configuration.pi.yaml` has empty `source_channel_id` and empty model slug fields. Session tools. FOR_AGENTS, setup-benny SKILL, then config write. No live automation write. |

Worker playbook. `parity/evidence/setup-benny/PLAYBOOK-required-explicit.md`

Capture lever. `parity/scripts/capture-setup-benny-required-explicit.mjs` (self-test green before live runs)

Path choice. Fail-closed ambiguous fixture. Happy-path full fill would need live Slack and real picker confirmation.

## Commands run

1. Confirmed models.mdc at locked digest `sha256:2b6b4668…6004`.
2. Seeded `parity/evidence/setup-benny/required-explicit/fixture-app` from shared Benny pack.
3. Wrote `PLAYBOOK-required-explicit.md` and capture script. Self-test green.
4. `node parity/scripts/capture-setup-benny-required-explicit.mjs --cursor-only` → `a3944805…`.
5. `node parity/scripts/capture-setup-benny-required-explicit.mjs --pi-only` → `c8714d86…`.
6. Wrote pair JSON + this report. Did not edit ledgers. Did not commit.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`. Evidence under `parity/evidence/setup-benny/required-explicit/` so sibling journeys stay untouched.
2. Prompt names the STATUS vocabulary and states the fail-closed rule from setup-benny. Strong cue. Boundary is still proved by empty channel field, no live automation, and product unchanged.
3. Both hosts wrote a partial draft config. Allowed by the prompt when `source_channel_id` stays empty and setup still fails closed.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
5. Did not commit.
6. Did not claim sibling SETUP-BENNY-* ids.

## Honest product gaps

1. This pair proves fail-closed on one missing required value (source channel), not a full happy-path fill of every section-3 field with live Slack.
2. Model-slug availability is only proved negatively (hosts did not invent slugs into the draft). There is no live model-picker enumeration artifact on either side.
3. Pi PTY observer flagged `inventedChrome=true` while the written config channel stayed empty. Settled screen shows refuse language, not a C… channel ID. Treat as scorer noise unless a re-score finds a real invented ID in events.
4. Acceptance STATUS reason strings remain DRAFT / host-dependent.
5. Repo working tree already showed dirty ledger files before this run. This worker did not modify them.

## Suggested follow-ups for the coordinator

1. Merge the pair into family-11 / `setup-benny-required-explicit` when ready. Close `PSTACK-SETUP-BENNY-REQUIRED-EXPLICIT-001` when oracle freeze allows.
2. Optional later pass. Happy-path with a real test channel and picker-confirmed model slugs, only if the account owner supplies those values.
3. Keep sibling SETUP-BENNY scenarios on their own pairs.
