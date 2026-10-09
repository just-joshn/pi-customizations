# u-journey-setup-panel-fanout report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair on real PTY. Planted `arena runners: inherit-parent, inherit-parent, inherit-parent` (L=3 aliases). Both hosts spawned 3 runners under `/arena` with no N override. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `43dc2c2b-215d-4765-ab70-2682cb620fd8` |
| pi | `925469ca-f277-4870-a986-2969e0e1ecbe` |

Pair. `parity/evidence/setup-panel-fanout/pair-setup-panel-list-fanout-1.json`

Fixture digest. `sha256:b3619375c3368685352e4e213ec1fb8d1391a661ff87c59f79e662c96b95ed43` (panel list L=3). Locked rule restored after each side (`sha256:2b6b4668…6004`).

## Contract held?

| Side | List length | Spawn / candidates | Panel-driven | Verdict |
| --- | --- | --- | --- | --- |
| cursor | 3 aliases | c1+c2+c3 on disk; settled Phase B “spawn 3 arena runners” | done `panelDriven=yes` | **yes** |
| pi | 3 aliases | session `task`×3; c1+c2+c3 on disk | done `panelDriven=yes` | **yes** |

Oracle. Durable `clamp.js`+`rationale.md` under each `cN/`, `fanout-note.md` quoting the runners list, `done.txt` `listLength=3 spawnCount=3 panelDriven=yes`, re-read settled screens, and Pi session tool order. Scorer `contractOk` true both sides.

## Commands run

1. Confirmed locked models.mdc digest, then built `fixture-panel-list.mdc` with three inherit-parent aliases.
2. Trusted fixture cwd in `/tmp/pi-ref-agent/trust.json`.
3. Wrote `parity/scripts/capture-setup-panel-fanout.mjs`.
4. `node parity/scripts/capture-setup-panel-fanout.mjs --self-test` (pass vs fail cases).
5. `node parity/scripts/capture-setup-panel-fanout.mjs --cursor-only` (~125s).
6. `node parity/scripts/capture-setup-panel-fanout.mjs --pi-only` (~49s).
7. Re-read settled screens, candidate trees, Cursor/Pi notes, Pi session (`task`×3).

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Configuration was a planted panel-list fixture, not a live `/setup-pstack` AskQuestion write. Behavior under test is list length → fan-out after the list exists.
3. Cursor `afterDigest` at settle matched the locked rule, not the planted panel bytes (`ruleUnchanged: false`). Concurrent `cursor-agent` processes share `~/.cursor/rules/pstack-models.mdc`. Fan-out still matched L=3 from the planted list at session start.
4. Prompt told hosts not to invent a different N and not to collapse duplicate aliases. That coaches the contract; independent oracles remain candidate dirs and Pi `task`×3.
5. Did not exercise `arena cross-judge pool` selection, nor architect/interrogate panel roles.
6. Did not edit `mismatches.json`, `requirements.json`, `progress.md`, or scenario stubs.
7. Did not commit.

## Honest product gaps

1. This pair proves fan-out after a multi-entry panel list is already on disk. It does not prove `/setup-pstack` itself can write a comma-separated panel list through the chat-form or AskQuestion path.
2. Shared host rule file races under parallel captures. Cursor end-of-run bytes were not a clean panel-fixture snapshot.
3. `arena cross-judge pool` “pick one differing-family value” remains unpaired.

## Suggested follow-ups for the coordinator

1. Merge `setup-panel-list-fanout-1` into `setup-panel-list-fanout` evidence and close `PSTACK-SETUP-PANEL-LIST-FANOUT-001` when ready.
2. Optional. Capture a `/setup-pstack` write that sets `arena runners` to a multi-entry list, then a second turn that runs `/arena`.
3. Optional. Pair `arena cross-judge pool` family selection separately.
