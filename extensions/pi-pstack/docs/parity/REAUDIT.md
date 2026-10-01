# Re-audit contract

Read `docs/parity/AUDIT.md` first. Its clause shape, kinds, verdicts, and check types still apply. This pass re-judges one slice after the fix wave described in `docs/parity/FIX.md`. You are a different agent from the fixers and from the first auditor. Do not trust their notes, and do not trust a fixer's report that a gap is closed. Read the native files and the tests.

## Your write scope

Edit only `docs/parity/clauses/<your slice>.json`. Never edit source, tests, skills, generated files, the gate, or any contract file. If you find a defect in native code, record it as a `gap` with `GAP:` and `FIX:` notes.

## What to do

1. Run `node scripts/check-native-parity.mjs --slice <slice> --no-tests`. Three kinds of finding appear.
   - `quote not found`. The generator or a fixer changed the text a clause cited. Open the new native file, decide whether the clause's obligation is still carried, and either repoint the quote at the new sentence or change the verdict to `gap` with a note naming what is now missing. A moved or reworded sentence that keeps every constraint stays `verified`. Dropping a number, ordering, exception, stop condition, or forbidden action is a `gap`.
   - `is gap`. Re-judge every gap against the current tree. Close it only when native text or a passing test now carries the obligation. For a behavior clause that executes, that means a named passing test, using the check types and runners in AUDIT.md. Many fixes landed as new test files: `test/parity-*.test.ts`, `test/benny-parity.test.ts`, and bun files under `test/helpers/` (`"runner": "bun"`, path `test/helpers/<file>`). `scripts/overlays/*.mjs` hold the helper defect fixes. `scripts/resource-rows/`, `scripts/resource-text.mjs`, and `scripts/resource-transforms.mjs` feed the generator. When you close a gap, replace its checks with ones that prove the new state and drop the `GAP:` note or keep a one-line `note` explaining the resolution.
   - `is external`. Keep the verdict unless the clause is not actually about a live third-party service. Do not widen `external` to cover missing native work.
2. A clause stays `gap` when the fix is missing, partial, or untested. Say precisely what remains in the note, in `GAP: ... FIX: ...` form. Do not soften.
3. Every content line must stay inside some clause. If a fix added a new obligation the slice's clauses do not cover, add a clause.
4. Never use `unaudited`. Never invent a test name. Names are exact, so read the test file. The gate runs tests in a final pass.

## Known limits, so you judge them fairly

- Pi cannot give a readonly child its extension tools without write tools, because SDK tool annotations are unverified hints. A clause that demands that behavior stays `gap` with that reason.
- The team-kit `alwaysApply` rules are deliberately not injected, pending a product decision. Those clauses stay `gap`.
- Peer dependencies stay `"*"` because Pi's `packages.md` requires it. A runtime warning in `src/host-version.ts` covers the minimum host version. Judge L686.1 on that.
- The zero-check READY race is closed by requiring two consecutive zero-check polls at one head SHA. A single reading never reaches READY.
- A clause about a live Slack, Linear, Notion, Datadog, Sentry, Databricks, Cursor Marketplace, or origin.cursor.com service is `external` when no credentials exist here. Native setup, gating, and fixture behavior around the service is `behavior` and needs native checks.

## Done

Run `node scripts/check-native-parity.mjs --slice <slice>` (with tests, not `--no-tests`) from the package root. You are done when its only findings are `gap` and `external` lines and every cited test passed. Reply with counts by verdict, how many gaps you closed and how many stayed open, every remaining `gap` id with a one-line reason, and every `external` id with its service.
