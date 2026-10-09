# Report: prin-guard-context pair

## Status

**pass** for `PSTACK-PRIN-GUARD-CONTEXT-001` on both hosts. Pair `prin-guard-context-1`. Adjacent principle ids not claimed.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `6910fcce-9e65-4d40-830e-fcf478d32991` | Leaf Read + `CallDynamicTool` Task routing + `GUARD-OK` (`contractHeld`) |
| Pi | `b5f36281-63a5-4572-8efc-4af4f27a7627` | Leaf Read + `task` general-purpose child + `GUARD-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/guard-context/pair-prin-guard-context-1.json`
- Capture script: `parity/scripts/capture-prin-guard-context.mjs`
- Fixture: `parity/evidence/principles/guard-context/fixture-app/` (40 seeded corpus dumps)
- Cursor proof copy: `parity/evidence/principles/guard-context/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/guard-context/fixture-out/pi/evidence/verify-out.txt`
- Capture logs: `capture-both.log` (Cursor side), `capture-pi.log` (Pi re-run)
- Decision log: `parity/evidence/principles/guard-context/.audit/u-journey-prin-guard-context.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/b1d3842f-6395-4894-85d2-a43a586bc4c2/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-41-18-387Z_01a11e52-63b3-7571-85fe-1a6b4b791a9b.jsonl`
- Pi child: `.../01a11e52-63b3-7571-85fe-1a6b4b791a9b/subagents/agent-a292c095-acec-4c6a-b953-551e48b736e1.jsonl`

## On-disk oracle (re-read)

Both hosts wrote `out/summary.json` with all eight `MARKER-*` tokens, left `GUARD-OK markers=8` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`), and wrote `verified=yes`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

Subagent routing (tightened oracle, tool-call / child-session only, not tool-catalog chrome):

- Cursor: several `CallDynamicTool` `namespace=cursor` `toolName=Task` calls, including a `poteto-agent` inventory lever, after leaf Read of `principle-guard-the-context-window/SKILL.md`.
- Pi: parent `task` with `subagent:general-purpose` plus a real child session under `subagents/`, after leaf Read of the Pi package skill path.

## Honest gaps

- First Pi attempt (`bd5cb492-...`) was discarded. Catalog prose (`TaskStop: Abort a running subagent`) had false-positived the loose chrome matcher. Oracle tightened; Pi re-run under flock.
- Prompt includes the poteto-mode leaf-read nudge used on other principle pairs, plus an explicit child Task/worker routing cue for the large corpus.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Subagent kinds differ (Cursor mixed generalPurpose arena + poteto-agent vs Pi general-purpose).
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).
- Shared rule serialized via `/tmp/pstack-parity-pstack-models.lock`. Digest stayed `sha256:2b6b4668...` before and after.

## Not claimed

- Adjacent principle requirement closure beyond GUARD-CONTEXT.
