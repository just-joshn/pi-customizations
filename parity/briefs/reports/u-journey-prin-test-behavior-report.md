# Report: prin-test-behavior pair

## Status

**pass** for `PSTACK-PRIN-TEST-BEHAVIOR-001` on both hosts. Pair `prin-test-behavior-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `b70c73d6-63a5-4255-b8a3-62f3217e5704` | Leaf Read + behavior-shaped test + `TEST-OK` (`contractHeld`) |
| Pi | `753e87d4-b2c8-4c0e-8fd4-1ca3bacbcbac` | Leaf Read + behavior-shaped test + `TEST-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/test-behavior/pair-prin-test-behavior-1.json`
- Capture script: `parity/scripts/capture-prin-test-behavior.mjs`
- Fixture: `parity/evidence/principles/test-behavior/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/test-behavior/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/test-behavior/fixture-out/pi/evidence/verify-out.txt`
- Cursor test copy: `parity/evidence/principles/test-behavior/fixture-out/cursor/test/slugify.test.js`
- Pi test copy: `parity/evidence/principles/test-behavior/fixture-out/pi/test/slugify.test.js`
- Decision log: `parity/evidence/principles/test-behavior/.audit/u-journey-prin-test-behavior.tsv`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/64f28010-ad07-4cc2-b6ca-1e655b25ba79/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T00-41-41-351Z_01a11e1b-cee7-73d7-8df2-cc72fe1a5328.jsonl`

## On-disk oracle (re-read)

Both hosts rewrote `test/slugify.test.js` from `assert.doesNotThrow(() => slugify('Hello, World!'))` to a call with that concrete input and a literal `hello-world` assertion (`assert.strictEqual` on Cursor, `assert.equal` on Pi). Both ran `node scripts/verify.mjs` and left `TEST-OK input="Hello, World!" expected=hello-world` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. Test file copies kept under `fixture-out/<side>/test/`.

Cursor transcript includes `Read` of `~/.claude/skills/principle-test-behavior-not-implementation/SKILL.md` and `Shell(verify.mjs)`. Pi session includes `read` of `extensions/pi-pstack/skills/principle-test-behavior-not-implementation/SKILL.md` and bash that rewrote the test and ran verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false.

## Honest gaps

- Prompt names the concrete input and expected literal so the agent does not have to invent them. That is stronger cueing than a pure organic "add a unit test" ask. The leaf-read nudge matches prove-it / never-block journeys.
- Cursor model chrome was Claude Haiku 5.5, not Auto. Pi used claude-sonnet-5-5 medium. Model families differ.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`). The `~/.claude` copy may lack `disable-model-invocation` in frontmatter; package copies used for the frontmatter gate have it.
- Verify's `undefinedWouldFail` probe asserts a fixed `assert.equal(stub(), 'hello-world')` shape, not a re-execution of the agent's exact test file under a stubbed import. Behavior shape of the kept test is judged from source plus a live `node --test` pass.
- No independent blinded judge subagent (brief forbade further subagents). Worker scored from transcripts and on-disk artifacts.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
