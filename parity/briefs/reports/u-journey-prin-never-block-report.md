# Report: prin-never-block pair

## Status

**pass** for `PSTACK-PRIN-NEVER-BLOCK-001` on both hosts. Pair `prin-never-block-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `c38eb9b1-9ac3-4d16-a43d-009c3c9d7eb8` | Leaf Read + `GREET-OK` + no AskQuestion tool (`contractHeld` after oracle tighten) |
| Pi | `d0a66bac-7951-4adb-a7d5-95b46f0d4e15` | Leaf Read + `GREET-OK` + no AskQuestion tool_call (`contractHeld` after oracle tighten) |

## Artifacts

- Pair: `parity/evidence/principles/never-block/pair-prin-never-block-1.json`
- Capture script: `parity/scripts/capture-prin-never-block.mjs`
- Fixture: `parity/evidence/principles/never-block/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/never-block/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/never-block/fixture-out/pi/evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/never-block/.audit/u-journey-prin-never-block.tsv`
- Rescore note: `parity/evidence/principles/never-block/rescore-results.json`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/051d0c3f-7305-4965-b857-c4e66509bb7f/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-34-05-437Z_01a11e14-d9fc-72d4-9be2-b22c1a9e4fe3.jsonl`

## On-disk oracle (re-read)

Both hosts implemented `greet()` as plain `hello, world`, wrote `plain` to `out/choice.txt`, ran `node scripts/verify.mjs`, and left `GREET-OK format=plain choice=plain` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker.

Cursor transcript includes `Read` of `~/.claude/skills/principle-never-block-on-the-human/SKILL.md` and `Shell(verify.mjs)`. No `AskQuestion` tool_use. Pi session includes `read` of `extensions/pi-pstack/skills/principle-never-block-on-the-human/SKILL.md` and bash that wrote product + choice + verify. `AskQuestion` appears only in tool-catalog / poteto-mode docs, not as a tool_call. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- First capture pass set `askedPermission` from explanatory prose ("instead of asking you which one"). Oracle tightened to tool-ask authority; observations rescored without re-running PTY. Live capture log still shows the pre-tighten false fail.
- Irreversible confirmation was not exercised. Guard held vacuously (`irreversibleAttempted: false`).
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`). The `~/.claude` copy lacks `disable-model-invocation` in frontmatter; package copies used for the frontmatter gate have it.
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).
- Prompt includes the poteto-mode leaf-read nudge used on prove-it. Not a pure organic trigger of never-block alone.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
