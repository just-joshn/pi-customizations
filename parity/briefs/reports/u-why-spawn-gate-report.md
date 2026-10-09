# u-why-spawn-gate report

## Status

**pass** (product gate landed; linked pair shows Pi Task investigators). Does not edit ledgers or close WHY-INVESTIGATOR-SPAWN.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `97771f92-7d64-4ad8-9821-48701fe13881` (reused from why-1) |
| pi | `3a299cdd-e423-436e-b850-e58fc207c688` (gate recapture) |

Pair. `parity/evidence/why/pair-why-2.json`

Baseline fail pair. `parity/evidence/why/pair-why-1.json` (Pi `ceff7d79`, bash-only)

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (Pi `ruleUnchanged: true`)

## Root cause

Pi injects `<subagent_usage>` with "default to doing the work yourself" and a five-or-fewer direct-tool heuristic. That matches a small `/why` motivation question. The parent finished Step 2 bash and answered without Step 3 investigator Tasks. Cursor showed `Running subagent` on the same question.

## Fix

Design A mirror of `how-spawn-gate`, adapted for why Step 2.

Product paths.

- `extensions/pi-pstack/src/why-spawn-gate.ts`
- `extensions/pi-pstack/test/why-spawn-gate.test.ts`
- `extensions/pi-pstack/src/index.ts` (`registerWhySpawnGate`)
- `parity/scripts/capture-why.mjs` (screens/rule-after write into `attempt.dir` so later single-side runs cannot overwrite a linked pair)

Gate behavior.

1. Arm on `<skill name="why"`.
2. Replace `subagent_usage` so the five-or-fewer heuristic does not apply.
3. Allow bash/read for Step 2 anchoring before the first settle-without-Task.
4. On settle without an investigator Task, one `agent_before_settle` continue with `pstack-why-spawn`.
5. After that nudge, block exploration tools until a `generalPurpose` / `general-purpose` Task starts (readonly not required).

## Verification

### Unit

`bunx vitest run test/why-spawn-gate.test.ts test/how-spawn-gate.test.ts` from `extensions/pi-pstack`. **13 pass.**

`bun run typecheck`. **pass.**

`bun run test` (full package). **2236 pass**, 2 fail unrelated to this change (`skills/poteto-help/SKILL.md` still contains `\bCursor\b`; `verify-journeys --no-workers` child-Task isolation). Neither file is in this unit's product diff.

### Live PTY

`node parity/scripts/capture-why.mjs --pi-only` (~212s) with `/tmp/pi-ref-agent/settings.json` packages pointing at this checkout.

Pi session `01a11cd7` tool sequence (measured from session jsonl).

1. `bash` / `pstack_context` / `bash` / `bash` (Step 2)
2. `task` `agent_type=general-purpose` `name=why-source-control` → subagent `2cc47f69`
3. `task` `agent_type=general-purpose` `name=why-synthesizer` → subagent `8b4bc428`
4. Final answer with Sources consulted

Settle nudge did not fire on this run. Parent Task'd before first settle. Subagent transcripts exist under the session `subagents/` directory. Detail. `parity/evidence/why/pi/3a299cdd-e423-436e-b850-e58fc207c688/method-a-session.json`

Cursor side reused why-1 (`Running subagent` already observed). No fabricated Task chrome.

## Deviations

1. Cursor not re-captured. why-1 Cursor attempt already proves investigator spawn chrome for this question and fixture.
2. Side-root `parity/evidence/why/pi/screen-*.txt` were overwritten by this `--pi-only` run before the capture-script fix. Attempt-dir copies are authoritative for why-2.
3. Did not edit `mismatches.json`, `requirements.json`, or `progress.md`.
4. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge pair-why-2 into the WHY-INVESTIGATOR-SPAWN close path when ready (needs commit hash per standing order 13 if closing a write-card-style gate).
2. Optionally re-run `--both` after the attempt-dir screen fix for a fully fresh linked pair.
3. Triage the two pre-existing full-suite failures outside this unit.
