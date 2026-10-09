# Report: prin-outcome-oriented pair

## Status

**pass** for `PSTACK-PRIN-OUTCOME-ORIENTED-001` on both hosts. Pair `prin-outcome-oriented-1`. Adjacent principle ids not claimed. Ledgers untouched.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `342ef99a-aa7a-41b2-9cea-1fad66a4e714` | Leaf Read + `priceFor` + callers converged + `pricingV1` deleted + `OUTCOME-OK` (`contractHeld`, `convergeWithoutDualPath`) |
| Pi | `df45bc1d-780c-410a-9475-a41c2bde9e1e` | Leaf Read + bash converge + `OUTCOME-OK` (`contractHeld`, `convergeWithoutDualPath`) |

## Artifacts

- Pair: `parity/evidence/principles/outcome-oriented/pair-prin-outcome-oriented-1.json`
- Capture script: `parity/scripts/capture-prin-outcome-oriented.mjs` (`--self-test`, `--both`)
- Fixture: `parity/evidence/principles/outcome-oriented/fixture-app/`
- Cursor proof copy: `parity/evidence/principles/outcome-oriented/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof copy: `parity/evidence/principles/outcome-oriented/fixture-out/pi/evidence/verify-out.txt`
- Capture log: `parity/evidence/principles/outcome-oriented/capture-both.log`
- Cursor transcript: `~/.cursor/projects/.../agent-transcripts/4187a9c2-62a3-499f-80fe-e00a531514ce/...jsonl`
- Pi session: `/tmp/pi-ref-agent/sessions/.../2026-10-09T01-15-38-505Z_01a11e3a-e489-71b0-9e6b-2a0e3d17cbd9.jsonl`

## On-disk oracle (re-read)

Both hosts added `src/pricing.js` exporting `priceFor`, rewired `cart.js` and `checkout.js` off `priceV1`, deleted `src/pricingV1.js`, and left `OUTCOME-OK cart="cart:5" checkout="pay:5" files=cart.js,checkout.js,pricing.js` under `evidence/verify-out.txt` (durable copies under `fixture-out/<side>/evidence/`). Both wrote `verified=yes` to the side-specific done marker. No bridge, compat, or dual-path file remained. `dualPath` stayed false. `convergeWithoutDualPath` true on both.

Cursor transcript includes `Read` of `~/.claude/skills/principle-outcome-oriented-execution/SKILL.md`. Poll timestamps show pricing write, caller edits, then v1 delete in one attempt. Pi session includes `read` of `extensions/pi-pstack/skills/principle-outcome-oriented-execution/SKILL.md` and bash that writes `pricing.js`, rewires callers, removes `pricingV1`, and runs verify. Package leaf copies have `disable-model-invocation: true`. `modelAutoInvoke` stayed false. Shared `pstack-models.mdc` digest was unchanged across the run (`sha256:2b6b4668...`).

## Honest gaps

- Prompt includes the poteto-mode leaf-read nudge used on other principle captures. Not a pure organic trigger of outcome-oriented alone.
- Leaf skill roots differ (`~/.claude/skills/...` vs `extensions/pi-pstack/skills/...`).
- Model chrome differs (Cursor screen unobserved vs claude-sonnet-5-5 medium).
- Tool-order scorer missed Pi's `rm` inside compound bash (`firstV1DeleteAt` null in session score). Converge still held via poll/disk oracle.
- Sequential same-scenario captures, not one `recordPair()` call.

## Not claimed

- No ledger edits (`parity/requirements.json`, `parity/mismatches.json`, `parity/progress.md`, scenario `execution.pairId`).
- No commit.
- No adjacent principle requirement closure.
