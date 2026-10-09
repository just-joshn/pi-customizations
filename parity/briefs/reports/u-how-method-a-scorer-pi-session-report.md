# u-how-method-a-scorer-pi-session report

**status.** done  
**scorer.** `how-method-a-v1` at `parity/scripts/score-how-method-a.mjs`  
**ledgers.** unchanged

## What changed

Pi Method A evidence lives in the session transcript (`toolCall` `name: "task"`, `subagent.started`), not in PTY chrome. The scorer now

1. Matches those Pi session signals (and still matches Cursor `Running subagent` / Task chrome).
2. Loads session text from `--session <path>`, else `method-a-session.json` in the attempt dir, else a time-windowed file under `$PI_CODING_AGENT_DIR/sessions/<cwd-slug>/`.
3. Ignores tools-schema `"name":"task"` entries that are not `toolCall` / `toolName` / `subagent.started`.

## Unit tests

```text
cd parity && npm test -- test/score-how-method-a.test.mjs
```

Result. 13 passed.

## CLI exits (measured)

| Attempt | Side | Exit | Notes |
| --- | --- | --- | --- |
| `c1abf807-141d-4731-a887-182cf312ad02` | cursor | 0 | PTY `Running subagent` unchanged |
| `951a315d-ac83-4901-9342-c82fbcd235a1` | pi | 0 | via `method-a-session.json`; also 0 with `--session` and with `PI_CODING_AGENT_DIR=/tmp/pi-ref-agent` alone |
| `8ad2dbc5-5ffa-48e3-8b76-0f6de82f6219` | pi | 1 | stays fail; auto-discover finds the time-matched session but it has no Task toolCall |
| `6f45e2db-c821-4663-bc85-ac9a01fc76e8` | cursor (historical) | 0 | regression check |

## Paths written

- `parity/scripts/score-how-method-a.mjs`
- `parity/test/score-how-method-a.test.mjs`
- `parity/briefs/reports/u-how-method-a-scorer-pi-session-report.md`
