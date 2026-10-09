# u-how-pair report

## Status

**pass** (linked Method A pair captured; gate live on Pi). Does not close HOW-WORKFLOW-EXPLAINER-STEP or edit ledgers.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `c1abf807-141d-4731-a887-182cf312ad02` |
| pi | `951a315d-ac83-4901-9342-c82fbcd235a1` |

Pair. `parity/evidence/investigate/pair-investigate-3.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Method A verdict

**pass** on both sides.

- Cursor. `Running subagent` in decoded PTY. `how-method-a-v1` scorer pass.
- Pi. Gate blocked first `read` with the how-spawn-gate message. Parent then started `task` (subagent `1ca875a7`) before the final answer. Session transcript is the primary evidence. Detail. `parity/evidence/investigate/how-method-a-pair-3-report.md`

Caveat (not a Method A fail). Pi Task used `agent_type: "explore"` rather than `generalPurpose`. PTY-only scorer returns false for Pi (Cursor chrome patterns only).

## Commands run

1. Confirmed `/tmp/pi-ref-agent/settings.json` packages include checkout `extensions/pi-pstack` (path load of uncommitted gate). Confirmed `registerHowSpawnGate` in `src/index.ts`.
2. `bunx vitest run test/how-spawn-gate.test.ts` from `extensions/pi-pstack` (6 pass).
3. `node parity/scripts/capture-investigate.mjs --both` (~238s).
4. `node parity/scripts/score-how-method-a.mjs` on both attempt dirs.
5. Re-read Pi session + subagent jsonl and both `identity.json` / screens / rule-after digests.

## Deviations

1. No separate package reinstall. Agent dir already pointed at the checkout path package; fresh Pi process loaded current tree.
2. Pi Method A scored from session + screens because `how-method-a-v1` is Cursor-chrome-only (false negative on Pi attempt dir).
3. Wrote `pi/.../method-a-session.json` session pointer (owned evidence path) for re-verification.
4. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Widen or coerce live Task args so `agent_type`/`subagent_type` lands on `generalPurpose` (or widen gate recognition of `explore` only if product intent allows). This run used `explore`.
2. Extend `score-how-method-a.mjs` to accept Pi session `task` / `subagent.started` (or take an optional `--session` path).
3. Merge pair-investigate-3 into the ledger when ready. Keep HOW-WORKFLOW-EXPLAINER-STEP open until commit hash + accepted close criteria.
4. Optional N=3 reference stop rule remains deferred; this cursor run also spawned.
