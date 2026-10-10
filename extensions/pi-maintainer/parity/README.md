# pi-maintainer parity ledger

pi-maintainer targets behavioral parity with Aider at commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` through Pi mechanisms. This directory defines the evidence required to establish parity. The edit obligation map is complete. Git, map, and lint coverage remain for their later SARs. All real ledger rows remain open.

The coverage gate requires every census unit to map to a ledger row or a justified non-claim. Coverage records obligations, not completed implementations. A complete edit obligation map can have zero uncovered units while `--feature edit` still fails on open rows.

Each SAR is gated on its own slice of the census. Its local contracts can pass before the later features exist. Cross-feature integration contracts remain obligations of the final gate.

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

A claimed unit must include a row of its owning slice. Moving an edit unit's only claims to open Git, map, or lint rows does not cover its edit contract. A feature slice must be nonempty and have contract rows. Reclassifying all its behavior as nonclaims cannot make its gate pass.

For a document that crosses a port boundary, coverage includes both the edit-side observable contract and the later integration behavior. For example, edit checks that the controller supplies editable paths and conversation hints to the repository-context port and includes the returned text without interpreting it as an edit. Map checks the tags, ranking, budget, and cache behavior that produce that text. Edit tests use the explicit port boundary, not a copy of Git, map, or lint. The map rows remain open until the map implementation and tests land. `--final` requires those integration rows verified.

This split does not change shared-test ownership. A test that actually needs two SARs belongs to the later one. Its census unit moves with its owner, not with whichever document mentions it.

`--feature <sar>` requires a `meta.aider` or `meta.evidence` tag for each claimed test or evidence unit in its slice. The passing tagged assertion must match a `tests` selector of one of that unit's mapped rows belonging to its owner. Metadata on an unreferenced test or a later integration row does not discharge the local contract. Any one mapped owner row can supply the tag, including through an explicit wildcard selector.

`--final` requires those tags for every claimed test and evidence unit and keeps the same owner-row binding. A later-owned shared test binds to its later owner's rows. A tag alone does not prove behavior. Ported tests assert literal outcomes through the public contract.

The shared-test audit reads all 212 pinned test bodies. Their owners are edit 152, git 47, map 9, and lint 4. Temporary Git setup alone does not make a test Git-owned. Assertions about repository inventory, tracked promotion, dirty state, or Git options do. The outside-root add test and the two dotenv-overlay tests operate on an option or supplied-root boundary without needing Git behavior. Four mention tests mock repository inventory and assert only edit-side path selection. All seven tests are edit-owned.

## Fresh runner evidence

Every feature and final gate runs the package's real Vitest suite. Any nonzero subprocess status, runner error, missing report, invalid JSON, unsuccessful report, failed suite, or failed assertion fails the gate. Unrelated failures cannot be ignored because a ledger's referenced assertions pass.

`--report <path>` names the output of this fresh run, relative to the package root or absolute. The gate removes an existing report at that path before running Vitest. It never accepts a previously supplied report as proof of the integrated source. Without this option it creates and cleans up a private temporary report directory.

`--fragment <path> --units <prefixes>` validates structure and census coverage without claiming verified behavior. The fragment path must be nonempty. Supplying `--fragment` without a path cannot switch to whole-ledger mode. The selection must be nonempty, and every comma-separated prefix must select census units. A missing, empty, or unknown prefix fails, even when another prefix is valid.

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
- A `fix` specifies the intended behavior instead of the source defect. Preserved parity rows still describe unrelated source semantics. For example, dry-run fixes suppress persistence while retaining ordinary patch deletion and move behavior. Empty-result fixes retain each format's matching policy while treating an empty successful result as success. The cumulative-preflight fix retains SEARCH/REPLACE matching but predicts targets using earlier blocks' virtual results.
- `pi`, `src`, and `tests` are filled during implementation. `pi` names Pi mechanisms such as `pi.on('turn_end')`. `src` lists package files. `tests` lists `<test file>::<test title>`.

## Patch application obligations

The patch follow-up rows remain open. Raw algorithm parity and fresh goldens do not prove application integration or the intent-backed fixes.

- `edit.patch.add-parent-file-error` covers ADD `parent/new.py` when `parent` is a regular file. Assert unchanged filesystem state, `ValueError`, and the Python `[Errno 17] File exists` diagnostic. Normalize temporary roots in both notices and `raised.message`. Run the same error case under two independent roots and compare the complete normalized outcomes. Do not omit the raised message or substitute Node EEXIST wording.
- `edit.patch.immediate-context-work` covers candidate-local exact matching. Assert literal match positions and fuzz values, then count original-line reads for immediate matches. The exact branch returns before unrelated lines are normalized. This is an operation-count obligation, not a timing or speedup claim.
- `edit.patch.dry-run-application` requires parsed DELETE, MOVE, and nested ADD to reach the actual patch applicator with dry-run enabled. Compare literal source and destination contents, file existence, and parent-directory state before and after. Isolated WorkingTree mutation guards are not proof of this row.
- `edit.patch.authorize-move-destination` requires approval for an existing destination outside the editable chat set before overwrite or source removal. `aider/coders/patch_prompts.py:22-24,147` and `aider/coders/base_coder.py:2226-2235` establish that intent. Include a declined-destination case that preserves both files. This does not impose blanket root containment on every edit.

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
