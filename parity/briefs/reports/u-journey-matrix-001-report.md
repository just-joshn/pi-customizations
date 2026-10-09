# u-journey-matrix-001 report

## Verdict

Wrote 16 journey-family stubs under `parity/scenarios/`. Status totals: missing=13, partial=3, paired=0. Zero families marked paired.

## Done predicate

At least 16 stub JSON files exist, one per contract section 8 family, each with id, family, status in {missing,partial,paired}, requirementIds, fixtureNeeds, evidencePaths, and nextAction. `ls parity/scenarios | wc -l` is >= 16. No stub uses paired without a complete, closed Cursor+Pi family coverage.

## Evidence inventory used

Cursor+Pi pair files found:
- `parity/evidence/investigate/pair-investigate-1.json`
- `parity/evidence/investigate/pair-investigate-2.json`
- `parity/evidence/investigate/pair-investigate-3.json`
- `parity/evidence/mode-one-message/pair-mode-one-message-1.json`
- `parity/evidence/setup-cancel/pair-report-cancel-1.json`
- `parity/evidence/setup-cancel/pair-report-cancel-2.json`
- `parity/evidence/setup-cancel/pair-setup-escape-cancel-1.json`
- `parity/evidence/setup-cancel/pair-setup-escape-cancel-2.json`
- `parity/evidence/setup-prepair/pair-report-canonical-2.json`
- `parity/evidence/setup-prepair/pair-setup-first-run-canonical-1.json`
- `parity/evidence/setup-prepair/pair-setup-first-run-canonical-2.json`
- `parity/evidence/setup-success/pair-setup-success-write-card-1.json`
- `parity/evidence/setup-success/pair-setup-success-write-card-2.json`

Open mismatches affecting status:
- `MODE-PLAIN-ENTER-STICKY` (requirement `PSTACK-MODE-ONE-MESSAGE-001`) keeps family 4 at partial.

## Family matrix

| family | id | status | evidence pairs linked | nextAction |
| --- | --- | --- | --- | --- |
| 1 | `journey-family-01-clean-install-setup-first-task` | partial | `parity/evidence/setup-prepair/pair-setup-first-run-canonical-2.json`, `parity/evidence/setup-prepair/pair-report-canonical-2.json`, `parity/evidence/setup-success/pair-setup-success-write-card-2.json`, `parity/evidence/setup-cancel/pair-setup-escape-cancel-2.json` | Add a clean-install pair that covers package discovery through first task under one fixture digest, then freeze acceptance definitions for SETUP-FLOW. |
| 2 | `journey-family-02-rerun-setup-role-config` | missing | none | Capture a paired re-run setup journey that mutates one role, asserts unrelated settings unchanged, and checks model identity on a real follow-up turn. |
| 3 | `journey-family-03-commands-and-nl-triggers` | missing | `parity/evidence/setup-cancel/pair-setup-escape-cancel-2.json` | Build the command inventory scenario set and capture pairs starting with help/invalid/cancel for each registered slash command. |
| 4 | `journey-family-04-mode-one-message-and-sticky` | partial | `parity/evidence/mode-one-message/pair-mode-one-message-1.json` | Fix Pi one-message vs sticky activation, then recapture mode-one-message and mode-sticky pairs until MODE-PLAIN-ENTER-STICKY closes. |
| 5 | `journey-family-05-playbook-complete-journeys` | partial | `parity/evidence/investigate/pair-investigate-3.json`, `parity/evidence/investigate/pair-investigate-2.json`, `parity/evidence/investigate/pair-investigate-1.json` | Keep how pairs current, then schedule the next playbook journeys (why, bug-fix/tdd, feature) with the same pair harness. |
| 6 | `journey-family-06-multiworker-designs-reviews` | missing | none | Capture a minimal swarm fan-out pair proving concurrent workers, model identity, and isolated writes before expanding to failure/cancel. |
| 7 | `journey-family-07-interrupt-compact-branch-resume` | missing | none | Define a paired interrupt→redirect→resume scenario with real PTY cancel and post-restart objective check. |
| 8 | `journey-family-08-durable-remote-continuation` | missing | none | Import host-continuation proposals into requirements, then capture a paired disconnect/reconnect/cancel journey. |
| 9 | `journey-family-09-timers-subscriptions-ci-wakes` | missing | none | Inventory Benny and loop/subscription entry points, then capture a paired timer+cancel+restart scenario. |
| 10 | `journey-family-10-pr-and-stack-workflows` | missing | none | Stand up a controlled repo fixture and capture a paired PR-readiness journey with one failing check. |
| 11 | `journey-family-11-benny-and-automations` | missing | none | Capture a paired Benny install+trigger journey with dedupe and fail-closed secret checks. |
| 12 | `journey-family-12-control-surface-dependencies` | missing | none | Map each control skill to a consumer task and capture the first terminal-control pair end to end. |
| 13 | `journey-family-13-generated-resources-reuse` | missing | none | Capture a paired create-verify or recall journey that proves discovery and reuse in a second session. |
| 14 | `journey-family-14-package-lifecycle` | missing | none | Script a paired disable→re-enable package journey asserting settings persistence and unrelated behavior. |
| 15 | `journey-family-15-faults-and-recovery` | missing | none | Pick one high-value fault (unavailable model during setup) and capture a paired recovery journey first. |
| 16 | `journey-family-16-combined-long-sessions` | missing | none | After mode sticky/one-message closes, capture a multi-workflow session pair with config digest and mode-state checks between stages. |

## Status rules applied

- paired: Cursor+Pi pairs cover the full mandatory family scope, and linked mismatches are not open.
- partial: some Cursor+Pi pair evidence covers a subset, or a pair exists with an open mismatch / incomplete scope.
- missing: no Cursor+Pi pair that advances the family (supporting non-pair probes do not upgrade status).

## Non-family file retained

`parity/scenarios/setup-budget-labels.json` already existed as a detailed scenario draft. Left unchanged.

## Decision trail

| ts | phase | decision | why | evidence | result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-08T17:47:00Z | start | u-journey-matrix-001 worker run | brief acceptance needs 16 family stubs and a count report | parity/briefs/u-journey-matrix-001.md | open |
| 2026-10-08T17:48:00Z | frame | treat family-level paired as empty until full scope closes | standing orders forbid fabricated paired evidence; open mode mismatch and incomplete playbook coverage | parity/evidence/*/pair-*.json; mismatches MODE-PLAIN-ENTER-STICKY | framed |
| 2026-10-08T17:49:00Z | harness | classify from existing pair files before writing stubs | prove-it-works against inventory, not memory | 13 pair-*.json under parity/evidence | inventory ready |
| 2026-10-08T17:50:00Z | stubs | write 16 family stubs with missing/partial only | sequence-verifiable-units; no paired without full closed coverage | parity/scenarios/journey-family-*.json | 16 written |
| 2026-10-08T17:52:00Z | verify | run ls wc and JSON field checks | acceptance VERIFY line | ls parity/scenarios | wc -l => 17; 16 journey-family stubs schema-ok | VERIFIED |

## Counts

- scenario files in `parity/scenarios/`: 17
- family stubs: 16
- missing: 13
- partial: 3
- paired: 0

