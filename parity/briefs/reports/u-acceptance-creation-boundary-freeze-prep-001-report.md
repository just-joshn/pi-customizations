# u-acceptance-creation-boundary-freeze-prep-001 report

**status.** Proposal only. Ledgers untouched. `acceptanceDefinitionsFrozen` left false. No invented Pi Automations UI.

throughput checkpoint: n/a, read-only investigation

## Recommendation

**Option A. keep-unverified.**

Leave `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` unverified until a real Pi Automations editor handoff exists and finishes the pair.

## Options

| Option | Meaning | Fits standing prefs |
| --- | --- | --- |
| A keep-unverified | Cursor half stays paid. Pi half stays unpaid. Requirement stays `unverified`. | yes (prefs 4, 5, done predicate) |
| B freeze Cursor-only | Owner accepts permanent Pi-incapable. Cell treated as Cursor-only. | no unless independent owner grants the reduction |

## Why A

Measured state. Cursor list `e11d7225` and editor title `475ab346` / re-verify `2c525e93` are paid. Fresh Pi `f4c7eec5` is `STATUS=env-blocked` with `automationsEditorUiAvailableInPiPty=false`. ENV mismatch is already `closed-env-resolved`.

Standing preference 4 forbids scope reduction for platform differences. Option B is that reduction. Preference 5 keeps unverified work unverified. The program done predicate still wants paired Cursor+Pi journeys. Hybrid Cursor-desktop-as-Pi is rejected by preference 7.

Prior Pi unit already preferred keep-unverified. This prep packages that judgment for G3 without freezing anything.

## When B would apply

Only after an independent owner (not the implementation parent) grants permanent Pi-incapable for this cell in writing. That grant still does not set `acceptanceDefinitionsFrozen` by itself.

## G3 owner decision language

Coordinator must not freeze without G3 owner + custody auth.

Do not set `acceptanceDefinitionsFrozen`.
Do not mark `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001` verified from this pack.
Preferred decision is Option A keep-unverified until Pi Automations editor exists.
Option B requires an independent owner grant that accepts permanent Pi-incapable, plus the same G3 owner + external custody auth before any acceptance-oracle freeze.

Custody pack at `parity/research/acceptance-custody-pack-001/` remains operator handoff only. Digests `e5761017…` / `9eea3685…`. Same-user checkout is not external custody. Owner remains null.

## Evidence index

Path. `parity/research/acceptance-creation-boundary-freeze-prep-001/evidence-index.json`

| Label | Attempt ID | Paid |
| --- | --- | --- |
| Cursor list | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | yes |
| Cursor editor title | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | yes |
| Cursor editor re-verify | `2c525e93-3392-4253-81ef-dd965fde2e7d` | yes |
| Fresh Pi | `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96` | no |

## Overview

This requirement asks first-time Benny triage or repro automations to finish only through the Automations editor handoff, with no enable before thread-safety. Cursor Agents Window already shows Inactive `benny-triage` and same-frame editor chrome titled `benny-triage`. Pi PTY has no `/automate` skill and no Automations editor surface.

## Key concepts

Creation boundary. Finish only via reviewed Automations editor. No direct backend. No draft-field URL. No enable yet.
Paired verify. Cursor journey and Pi journey both required for verified-pass-paired.
Cell freeze vs oracle freeze. Option B would change this requirement cell. `acceptanceDefinitionsFrozen` freezes the acceptance oracle and is a separate G3 gate.

## How it works

Cursor `/automate` produced Inactive `benny-triage` (`e11d7225`). Same-frame editor titled `benny-triage` was paid via `475ab346` and re-verified under `2c525e93`. Pi attempt `f4c7eec5` stopped with honest env-blocked text and no editor chrome. Host probe stamps `automationsEditorUiAvailableInPiPty=false`.

## Where things live

| Kind | Path |
| --- | --- |
| Proposal | `parity/research/acceptance-creation-boundary-freeze-prep-001/proposal.json` |
| Evidence index | `parity/research/acceptance-creation-boundary-freeze-prep-001/evidence-index.json` |
| Verify digests | `parity/research/acceptance-creation-boundary-freeze-prep-001/verify-evidence-index.sh` |
| Custody pack | `parity/research/acceptance-custody-pack-001/` |
| This report | `parity/briefs/reports/u-acceptance-creation-boundary-freeze-prep-001-report.md` |

## Gotchas

Do not invent a Pi Automations editor to close the pair.
Do not treat ENV close as requirement close.
Do not treat custody-pack presence as freeze authorization.
Do not enable Inactive `benny-triage` until thread-safety work is ready.
Scorer `forbidden=true` on the Pi observations file is a known prompt-phrase false positive. Screens and done line are the oracle.

## Ledger safety

This unit did not edit `parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, `parity/dependencies.json`, `parity/completion.json`, or other ledgers. Measured at write time. `acceptanceDefinitionsFrozen=false`, `acceptanceDefinitionOwner=null`, requirement status `unverified`.

## Verify

```sh
sh parity/research/acceptance-creation-boundary-freeze-prep-001/verify-evidence-index.sh
```

Expect. `PASS` and every listed digest matching on-disk bytes.
