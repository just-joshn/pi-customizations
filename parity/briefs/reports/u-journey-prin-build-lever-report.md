# Report: prin-build-lever pair

## Status

**pass** for `PSTACK-PRIN-BUILD-LEVER-001` on both hosts. Pair `prin-build-lever-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `ae01feb5-b373-4d64-9b2d-8d5b0b67c080` | Leaf Read + `scripts/rewrite-prefix.mjs` + `PREFIX-OK` (`contractHeld`) |
| Pi | `889c66cf-151f-48ba-9a4d-d80f1201fa80` | Leaf Read + `scripts/rewrite-prefix.mjs` + `PREFIX-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/build-lever/pair-prin-build-lever-1.json`
- Capture script: `parity/scripts/capture-prin-build-lever.mjs`
- Cursor lever + proof: `parity/evidence/principles/build-lever/fixture-out/cursor/scripts/rewrite-prefix.mjs`, `.../evidence/verify-out.txt`
- Pi lever + proof: `parity/evidence/principles/build-lever/fixture-out/pi/scripts/rewrite-prefix.mjs`, `.../evidence/verify-out.txt`
- Decision log: `parity/evidence/principles/build-lever/.audit/u-journey-prin-build-lever.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/8180c89c-6511-4392-8f21-01120528d326/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-33-20-300Z_01a11e14-29ac-768b-8b7d-51faf2e1ced4.jsonl`

## On-disk oracle (re-read)

Both hosts left `src/{alpha,beta,gamma}.js` at `APP_*`, wrote `scripts/rewrite-prefix.mjs`, and kept `PREFIX-OK units=3` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/`). Both wrote `verified=yes` to the side-specific done marker.

Worker re-ran each durable lever against a restored LEGACY_ baseline. Both produced `PREFIX-OK units=3` again.

Cursor transcript includes `Read` of `principle-build-the-lever/SKILL.md` and `Write` of `scripts/rewrite-prefix.mjs`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-build-the-lever/SKILL.md` and a bash heredoc that created the same lever path. Package leaves under `parity/reference/cursor-plugins/pstack` and `extensions/pi-pstack` have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt includes the same leaf-read nudge used on prove-it (`read that principle's leaf SKILL.md`). Not a bare organic first try.
- Prompt also asks for a reviewer-rerunnable script. That steers toward a lever without naming Build the Lever.
- Cursor Read the user skill at `~/.claude/skills/principle-build-the-lever/SKILL.md`, which lacks `disable-model-invocation`. Package copies used for the frontmatter oracle keep the flag true.
- Pi created the lever via bash heredoc, so the Write-tool scorer missed `wroteLever`. On-disk lever path still satisfied the contract.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Auto vs claude-sonnet-5-5 medium).

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
