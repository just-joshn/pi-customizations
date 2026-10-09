# u-journey-setup-load-state report

## Status

**fail** for `PSTACK-SETUP-LOAD-STATE-001` as a linked pair. Pi loads existing budget and role markers and lists the retired `how critics` line. Cursor loads the budget but mis-states roles as all `inherit-parent`, misses `bug-fix: auto`, and claims there are no retired roles to drop. Pair JSON published. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| Pi | `3f46cd66-2f53-40f1-bbcc-2c7de7828615` |
| Cursor | `54a67064-eac9-4e9b-921b-c23085ef3295` |

Fixture both sides. `parity/evidence/setup-load-state/fixture-with-retired.mdc`  
Digest. `sha256:e8dcb7b71c421dd7ceae42b69f478396223d15ffe12257cb963fe7bba4e8f0a2`

Pair. `parity/evidence/setup-load-state/pair-setup-load-state-retired-1.json`

Locked reference rule restored after each side. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

## Fixture vs current choices

Fixture deltas from the locked rule.

- `# budget: small (medium)` kept
- `bug-fix: auto` (locked has `inherit-parent`)
- trailing retired line `how critics: inherit-parent`

## Pi observations

Measured from `parity/evidence/setup-load-state/pi/screen-07-pre-cancel.txt` and `screen-09-final.txt`.

AskQuestion prompt (collapsed later as skipped).

> Pick a budget (current: small (medium)). Roles currently all inherit-parent except bug-fix: auto. Retired line dropped: how critics.

| Check | Result |
| --- | --- |
| Load budget from existing rule | pass |
| Load marker role `bug-fix: auto` | pass |
| Drop and list retired `how critics` | pass |

Path. AskQuestion via `pstack_setup` state. Cancelled before write. First budget panel (`screen-01-budget.txt`) still said "all roles are inherit-parent" without the marker or retired line. A later panel corrected that. Cite the corrected prompt as the load-state proof.

Orphan. `26843b51-a913-4acf-a166-f6c39533fbfb` hung after the successful attempt. No `how critics` evidence. Not cited.

## Cursor observations

Measured from `parity/evidence/setup-load-state/cursor/screen-01-budget.txt` and `screen-02-after-chatform.txt`.

Budget.

> Current pstack rule: budget small (medium), and every role is inherit-parent

Role table after choosing `small — medium reasoning`.

> \| bug-fix \| inherit-parent \|

Retired handling.

> No retired roles to drop.

| Check | Result |
| --- | --- |
| Load budget from existing rule | pass |
| Load marker role `bug-fix: auto` | fail (showed `inherit-parent`) |
| Drop and list retired `how critics` | fail (`No retired roles to drop`) |

Path. Chat form (AskQuestion MCP missing on this harness). No write card. `rule-after.mdc` matched the locked shape (no `how critics`, `bug-fix: inherit-parent`), not the fixture.

Discarded first Cursor attempt `9655baed-…` under `cursor/poisoned-9655baed-budget-only-needed/`. Observations matched typed prompt text. Not evidence.

## Host deltas

| Topic | Cursor | Pi |
| --- | --- | --- |
| UX | chat-form budget list | AskQuestion panel |
| Load mechanism | model reads `~/.cursor/rules/pstack-models.mdc` per skill | `pstack_setup` action `state` returns `dropped` |
| Budget named | yes | yes |
| `bug-fix: auto` as current | no | yes |
| `how critics` listed as dropped | no | yes |

## Commands run

```
node parity/scripts/capture-setup-load-state.mjs --pi-only
node parity/scripts/capture-setup-load-state.mjs --cursor-only
```

Second Cursor run used a budget-only reply so observations cannot pass on operator prompt text.

## Artifacts

- Lever. `parity/scripts/capture-setup-load-state.mjs`
- Evidence. `parity/evidence/setup-load-state/`
- Pair. `parity/evidence/setup-load-state/pair-setup-load-state-retired-1.json`
- Decision log. `parity/evidence/setup-load-state/.audit/decisions.tsv`
- Report. this file

## Forbidden paths

Did not edit `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`. Did not commit.

## Suggested coordinator follow-ups

1. Keep `PSTACK-SETUP-LOAD-STATE-001` open until Cursor shows `bug-fix: auto` from this fixture and lists `how critics` as dropped (or a structured tool mirrors Pi’s `dropped` array).
2. Pi side can cite attempt `3f46cd66-…` and the pair JSON for load-from-existing plus retired-line listing.
3. Optional. Tighten Pi’s first AskQuestion draft so the first panel already names marker roles and dropped lines (later panel already does).
