# u-setup-load-state-cursor report

## Status

**pass** for Cursor `SETUP-LOAD-STATE-CURSOR` under isolation. Fixture digest held through the run. Agent named `bug-fix: auto` and listed retired `how critics`. Pair updated to `pass-paired` reusing Pi `3f46cd66`. Ledgers untouched. No commit.

Prior Cursor miss (`54a67064`) was a **harness race**, not a real load bug. Concurrent setup captures restore `~/.cursor/rules/pstack-models.mdc` to the locked digest while Cursor is mid-journey. Isolated recapture proves load works when that file stays planted.

## Attempt IDs

| Side | Attempt ID | Role |
| --- | --- | --- |
| Cursor | `b4bac448-d442-4c34-9eec-b73895bd063b` | isolated recapture (pass) |
| Cursor | `54a67064-eac9-4e9b-921b-c23085ef3295` | superseded (race fail) |
| Pi | `3f46cd66-2f53-40f1-bbcc-2c7de7828615` | reused pass |

Fixture. `parity/evidence/setup-load-state/fixture-with-retired.mdc`  
Digest. `sha256:e8dcb7b71c421dd7ceae42b69f478396223d15ffe12257cb963fe7bba4e8f0a2`

Pair. `parity/evidence/setup-load-state/pair-setup-load-state-retired-1.json`

## Isolation proof

Peers at start and end. none (`node …capture-setup-*.mjs` only).

Shared-rule lock. `~/.cursor/rules/pstack-models.mdc.parity-lock` (fcntl held for the run).

Rule digests (`cursor/rule-digests.json`). planted, 00-ready, 01-budget, 02-after-chatform, 07-pre-cancel, and rule-after all equal the fixture digest. `fixtureHeldThroughScreens: true`. `midRunLocked: false`.

`rule-after.mdc` still has `bug-fix: auto` and trailing `how critics`. Live `~/.cursor/rules/pstack-models.mdc` restored to locked digest after cancel.

## Cursor observations (isolated)

Measured from agent-visible screen text. Typed reply was only `small — medium reasoning`. Scorer drops `→` echo lines.

From `screen-01-budget.txt` (before budget reply).

> Current rule budget: small — medium reasoning. Retired role that will be dropped: how critics.

From `screen-07-pre-cancel.txt` (after budget reply).

> │ bug-fix              │ auto           │

| Check | Result |
| --- | --- |
| Load budget from existing rule | pass |
| Load marker role `bug-fix: auto` | pass |
| Drop and list retired `how critics` | pass |

Path. chat-form. No write card. Cancel before write.

## Miss classification

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Prior Cursor fail was harness race | yes | Prior `rule-after` matched locked digest while this isolated run held fixture throughout. Concurrent `capture-setup-budget-apply` (and siblings) restore the shared Cursor rule even on `--pi-only`. |
| Real Cursor load bug | no under isolation | `markerRoleLoaded` and `retiredListed` true with fixture visible on disk at every checkpoint. |

## Commands run

```
node parity/scripts/capture-setup-load-state.mjs --cursor-only
```

Capture script gains. peer refusal, fcntl lock helper, per-screen rule digests, expected fixture digest gate.

## Artifacts

- Lever. `parity/scripts/capture-setup-load-state.mjs`
- Evidence. `parity/evidence/setup-load-state/`
- Pair. `parity/evidence/setup-load-state/pair-setup-load-state-retired-1.json`
- Digests. `parity/evidence/setup-load-state/cursor/rule-digests.json`
- Log. `parity/evidence/setup-load-state/cursor-capture-isolated.log`
- Report. this file

## Forbidden paths

Did not edit `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`. Did not commit.

## Suggested coordinator follow-ups

1. Close or reclassify `SETUP-LOAD-STATE-CURSOR` / `PSTACK-SETUP-LOAD-STATE-001` from this pair.
2. Serialize writers of `~/.cursor/rules/pstack-models.mdc` across parity setup captures (same lock path or stop restoring the Cursor rule from Pi-only runs).
