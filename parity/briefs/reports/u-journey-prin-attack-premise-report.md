# Report: prin-attack-premise pair

## Status

**pass** for `PSTACK-PRIN-ATTACK-PREMISE-001` on both hosts. Pair `prin-attack-premise-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `57e687cf-f41b-46bc-a084-493c3a40fc61` | Leaf Read + premise + census + `PREMISE-OK` (`contractHeld`) |
| Pi | `4f10f963-4a6b-4535-a836-9a6971c045a9` | Leaf Read + premise + census + `PREMISE-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/attack-premise/pair-prin-attack-premise-1.json`
- Capture script: `parity/scripts/capture-prin-attack-premise.mjs`
- Fixture: `parity/evidence/principles/attack-premise/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/attack-premise/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/attack-premise/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/attack-premise/.audit/u-journey-prin-attack-premise.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/ecdbecf3-0002-4bf3-8d29-ba3242b5c649/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-01-30-778Z_01a11e2d-f519-71af-a099-ec07c0d3b058.jsonl`

## On-disk oracle (re-read)

Both hosts wrote `evidence/premise.txt` naming the shared undersized-alpha premise, added a rerunnable `scripts/census.mjs`, ran verify, and left `PREMISE-OK premise=yes census=yes files=actors.js,assign.js,run.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. Neither added `capacity.js`, `buffer.js`, or an alpha-queue compensatory file.

Cursor census stayed skewed (`alpha=100 beta=0 gamma=0`) with `assign.js` unchanged. Pi rotated `pickLeader` after the census (`alpha=10 beta=10 gamma=10`). Requirement accepts premise plus census before the next fix. Both paths meet that bar.

Cursor transcript includes `Read` of `~/.claude/skills/principle-attack-the-premise/SKILL.md`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-attack-the-premise/SKILL.md`. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on prove-it and never-block. Not a pure organic trigger of attack-premise alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor unobserved on screen dumps vs claude-sonnet-5-5 medium).
- Pi went further and removed the assignment asymmetry. Cursor stopped after premise plus census. Both satisfy the required observation.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
