# pi-maintainer parity ledger

pi-maintainer targets behavioral parity with Aider at commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` through Pi mechanisms. This directory defines the evidence required to establish parity. The ledger and coverage map are not yet complete.

The coverage gate requires every census unit to map to a ledger row or a justified non-claim. Each SAR is gated on its own slice of the census, so one SAR can pass before the next one starts.

| Command | Units that must be covered | Rows that must be verified |
| --- | --- | --- |
| `node scripts/check-parity.mjs` | every census unit | none |
| `node scripts/check-parity.mjs --feature <sar>` | the units in the slice of `<sar>` | every row whose `feature` is `<sar>` |
| `node scripts/check-parity.mjs --final` | every census unit | every row |

Every run prints one progress line per SAR: slice size, covered units, uncovered units, rows, and verified rows. Every run, including `--fragment`, fails when a shared-module test unit has no owner, when an owner is not a SAR, or when `test-owners.json` names a unit that is not a shared-module test in the census.

## Files

- `sources.json` pins the four reconstruction documents by SHA-256, their evidence directories, the Aider checkout, and the Aider test modules the evidence ran. Its `testModuleOwners` maps each single-purpose test module to the SAR that owns all of its tests.
- `test-owners.json` maps each test unit of the shared modules `test_coder`, `test_commands`, `test_main`, and `test_models` to one SAR.
- `ledger.json` holds the rows. A row is one observable Aider behavior contract.
- `coverage.json` maps every census unit to rows or to a non-claim.
- `../scripts/census.mjs` enumerates the units. Run `node scripts/census.mjs` for counts and `--json` for the full list.
- `../scripts/check-parity.mjs` is the gate.

## Census units

The census is mechanical, so nothing in the sources can be skipped silently.

- Document units are each paragraph, list item, table row, code block, and mermaid block of the four documents. Their ids look like `git/6-dirty-checkpoints-precede-assistant-writes/p2`. The middle part is the slug of the nearest heading. The letter is the unit kind (`p` paragraph, `i` list item, `r` table row, `c` code, `m` mermaid, `q` quote) and the number counts units inside that heading.
- Evidence units are recorded probe cases from the evidence directories, such as `ev-git/probe/inventory-semantics`.
- Aider test units are test functions in the pinned modules, such as `aider-test/test_editblock/TestUtils.test_replace_multiple_matches`.

## Slices and ownership

The slices of the four SARs partition the census. The slice of a SAR holds:

- its document units, `<sar>/...`
- its evidence units, `ev-<sar>/...`
- every test unit of a module that `testModuleOwners` assigns to it
- every shared-module test unit that `test-owners.json` assigns to it

An Aider test belongs to the SAR whose behavior it asserts. A test that needs code from two SARs belongs to the later one in the build order edit, git, map, lint, because it can pass only once that SAR exists. A test of behavior outside the four features still has an owner: the SAR whose slice records it as a non-claim.

`--feature <sar>` requires a `meta.aider` or `meta.evidence` tag for each test or evidence unit in the slice that maps to a row of that SAR. A slice unit that maps only to rows of other SARs is checked by `--final`, which requires the tag for every test or evidence unit that maps to any row.

## Rows

```json
{
  "id": "edit.sr.first-match",
  "feature": "edit",
  "behavior": "A SEARCH/REPLACE block replaces only the first region that matches the SEARCH text.",
  "aider": ["aider/coders/editblock_coder.py:146-154", "aider/coders/search_replace.py:434-445"],
  "kind": "parity",
  "status": "open",
  "pi": [],
  "src": [],
  "tests": []
}
```

- `id` is `<feature>.<area>.<behavior-slug>`, lowercase kebab inside each part.
- `feature` is the owner, one of `edit`, `git`, `map`, `lint`. A behavior that needs code from several features belongs to the latest one in the build order edit, git, map, lint, because it can only be verified once that feature exists. Example: "automatic commit happens before lint" needs git and lint, so it is `lint`.
- `behavior` is one observable, testable sentence about what Aider does. Describe inputs and outputs, not Python internals.
- `aider` lists source coordinates `path:lines` at the pinned commit. Copy them from the documents or read the checkout.
- `kind` is `parity`, or `fix` for a documented defect or documentation-versus-code mismatch. A `fix` row also carries `"fix": { "defect": "...", "intent": "...", "behavior": "..." }`. `defect` states the documented problem. `intent` cites the evidence of what Aider meant (help text, documentation, a test name, a prompt, a comment). `behavior` states what pi-maintainer does instead, which must be the intended behavior.
- `status` is `open` until the implementation lands and its tests pass, then `verified`.
- `pi`, `src`, and `tests` are filled during implementation. `pi` names Pi mechanisms such as `pi.on('turn_end')`. `src` lists package files. `tests` lists `<test file>::<test title>`.

## Coverage

```json
{
  "edit/searchreplace-parsing-and-matching/p1": { "rows": ["edit.sr.first-match"] },
  "edit/provenance-evidence-methodology-and-scope/p1": { "nonclaim": "provenance", "note": "reconstruction date and checkout" }
}
```

A unit maps to `rows` when it states, depicts, or tests any Aider behavior, including diagrams, tables, and summaries that restate behavior covered elsewhere. Otherwise it is a non-claim with one of these categories and a short note.

- `provenance` covers who reconstructed what, when, from which checkout, and with which evidence classes.
- `evidence` covers pointers to artifacts, logs, hashes, test totals, and reproduction commands.
- `meta` covers navigation sentences, list lead-ins, open questions with no behavior, and statements about what the document does not claim.
- `pi-owned` covers Aider behavior whose Pi equivalent is Pi's own built-in behavior with no extension work, such as provider transport, retries, streaming display, cost display, and session storage. The note names the Pi behavior.
- `out-of-scope` covers subsystems outside the four features, such as the Streamlit GUI, analytics, the benchmark harness, voice, web scraping, clipboard, and Aider's own documentation help. The note gives the reason.

Aider's own installation defects are not non-claims. They map to rows about pi-maintainer installing completely.

An Aider test unit that checks in-scope behavior maps to the rows it checks. Its ported Vitest test carries `meta.aider`, an array of unit IDs without the `aider-test/` prefix. An evidence replay test carries `meta.evidence`, an array of full evidence unit IDs.

The gate reads these arrays from passing assertions in the Vitest JSON report. Test-title tags do not satisfy this check. `test/support/vitest-meta.ts` declares the metadata types.
