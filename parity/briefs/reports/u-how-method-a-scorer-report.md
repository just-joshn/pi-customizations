# u-how-method-a-scorer report

**status.** done  
**scorer.** `how-method-a-v1` at `parity/scripts/score-how-method-a.mjs`  
**ledgers.** unchanged (no edits to mismatches, requirements, progress, or investigate evidence)

## What it checks

Method A from `parity/reviews/how-explainer-disposition.md`. The parent turn must start an explainer Task (or show `Running subagent` chrome) before the final answer. The scorer decodes PTY `events.jsonl` (`kind: output` / `dataB64`), optionally appends a session transcript file if present, strips ANSI, then reports signal hits as JSON on stdout.

Exit codes. `0` pass, `1` fail, `2` bad input.

## Unit tests

Command (from `parity/`):

```text
npm test -- test/score-how-method-a.test.mjs
```

Result. 8 passed.

## Historical self-check

Commands (from `parity/`):

```text
node scripts/score-how-method-a.mjs \
  evidence/investigate/cursor/6f45e2db-c821-4663-bc85-ac9a01fc76e8
```

| Field | Value |
| --- | --- |
| exit code | 0 |
| `pass` | `true` |
| `runningSubagent.found` | `true` |
| `taskTool.found` | `true` |
| `readonlyExplainer.found` | `false` |
| `gateBlockReason.found` | `false` |

```text
node scripts/score-how-method-a.mjs \
  evidence/investigate/pi/8ad2dbc5-5ffa-48e3-8b76-0f6de82f6219
```

| Field | Value |
| --- | --- |
| exit code | 1 |
| `pass` | `false` |
| `runningSubagent.found` | `false` |
| `taskTool.found` | `false` |
| `readonlyExplainer.found` | `false` |
| `gateBlockReason.found` | `false` |

These match the disposition table (cursor `6f45e2db` spawn yes, pi `8ad2dbc5` spawn no).

## Live capture

Did not wait on in-flight cursor attempt `c1abf807-141d-4731-a887-182cf312ad02` (FORBIDDEN).

## Paths written

- `parity/scripts/score-how-method-a.mjs`
- `parity/test/score-how-method-a.test.mjs`
- `parity/briefs/reports/u-how-method-a-scorer-report.md`
