# u-how-task-agent-type report

Status. Done for the unit scope. Coordinator still owns ledger close and paired recapture.

## Recognition rule

`explainerTaskStarted` sets Method A `spawned` when all of the following hold.

1. Tool name is `Task` or `task`.
2. Readonly is true via `readonly: true` or a prompt that matches `/^\s*READONLY\b/i` (covers live `Readonly task:`).
3. Agent kind is one of `generalPurpose`, `general-purpose`, `general_purpose`, or `explore` with `name === "how-explainer"`.

Bare `explore` without that name stays unrecognized. Non-readonly how-explainer Tasks stay unrecognized. Gate block list and settle nudge are unchanged. No host auto-spawn.

## Evidence

| Source | Fact |
| --- | --- |
| `parity/evidence/investigate/pi/951a315d-ac83-4901-9342-c82fbcd235a1/method-a-session.json` | Live Task used `agent_type: "explore"`, `name: "how-explainer"`, prompt starting `Readonly task:` |
| `parity/evidence/investigate/how-method-a-pair-3-report.md` | Method A spawn-before-answer held; prior `explainerTaskStarted` would return false for that shape |
| Prior unit for `3ebef40f` | Still accepts `agent_type: "general-purpose"` + READONLY prompt |

## Diff

- `extensions/pi-pstack/src/how-spawn-gate.ts` — widen `explainerTaskStarted` as above.
- `extensions/pi-pstack/test/how-spawn-gate.test.ts` — add 951a315d shape test plus reject cases (wrong name, non-readonly).

Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.

## Verify

TDD. New test failed first (`expected false to be true` on the live explore shape), then passed after the widen.

```text
cd extensions/pi-pstack
bunx vitest run test/how-spawn-gate.test.ts
# Test Files  1 passed (1)
# Tests  7 passed (7)

bun run typecheck
# exit 0
```

## Follow-up for coordinator

Schedule paired recapture when ready. Close HOW-TASK-AGENT-TYPE in the ledger after that evidence lands. Commit is operator-gated per standing orders.
