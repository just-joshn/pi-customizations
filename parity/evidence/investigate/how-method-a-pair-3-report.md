# Method A pair-investigate-3

Status. Measured **pass** for Method A on both sides of linked pair `investigate-3`. This does not close the mismatch row.

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` on both attempts. `ruleUnchanged` true on both (rule-after digests match locked fixture).

| Side | Attempt ID | Method A | Evidence |
| --- | --- | --- | --- |
| cursor | `c1abf807-141d-4731-a887-182cf312ad02` | pass | PTY shows `Running subagent`. Scorer `how-method-a-v1` pass. |
| pi | `951a315d-ac83-4901-9342-c82fbcd235a1` | pass | Session tool sequence below. Gate blocked first `read`, then parent `task` ran and a subagent transcript exists before the final answer. |

## Pi parent tool sequence (session)

Session. `/tmp/pi-ref-agent/sessions/--Users-josh-desktop-src-personal-pi-pstack-parity-again-parity-fixtures-first-run--/2026-10-08T17-24-35-337Z_01a11c8b-a189-76b0-9d35-1779fd21420c.jsonl`

1. User message delivers `<skill name="how" ...>`.
2. Assistant calls `read` on `skills/how/references/explainer-prompt.md`.
3. Tool result is the gate block reason. `The how skill is active. Spawn one readonly Task (subagent_type generalPurpose, how explainer role) before direct exploration or the final answer (Step 2b / Step 2a).`
4. Assistant calls `task` with `agent_type: "explore"`, `name: "how-explainer"`, prompt starting `Readonly task:`.
5. `subagent.started` / subagent transcript `agent-1ca875a7-0d83-4fa4-a029-7f823f2ee06d.jsonl`.
6. Tool result returns explainer overview. Parent then emits the final answer.

Screen corroboration. `parity/evidence/investigate/pi/screen-01-after-trigger.txt` shows the block reason and the `task agent_type="explore"` chrome before settle.

## Cursor Method A

Scorer output (rerunnable).

```text
node parity/scripts/score-how-method-a.mjs parity/evidence/investigate/cursor/c1abf807-141d-4731-a887-182cf312ad02
# pass: true; runningSubagent.found: true
```

## Scorer note (Pi false negative)

`score-how-method-a.mjs` v1 patterns match Cursor chrome (`Running subagent`, `cursor · Task`). On this Pi attempt dir alone it reports `pass: false` with no signals. Disposition Method A still passes from the session Task-before-answer sequence above. Do not treat the Pi PTY-only scorer miss as a Method A fail.

## Strict Step 2b shape (out of Method A pass/fail, but observed)

Live Pi Task used `agent_type: "explore"`, not `generalPurpose` / `general-purpose`. `explainerTaskStarted()` would still return false for that call. Gate nonetheless blocked the first exploration `read` and the parent then started a Task before answering. Prior pi-only `3ebef40f` used `general-purpose`; this linked run regressed the agent_type shape while still satisfying Method A spawn-before-answer.

## Pair path

`parity/evidence/investigate/pair-investigate-3.json`
