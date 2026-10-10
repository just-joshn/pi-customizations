# pi-maintainer parity ledger

pi-maintainer reproduces Aider at commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` through Pi mechanisms. This directory proves that claim. Every census unit is either covered by a ledger row with passing tests or classified as a non-claim with a reason. The gate fails on anything else.

## Files

- `sources.json` pins the four reconstruction documents by SHA-256, their evidence directories, the Aider checkout, and the Aider test modules the evidence ran.
- `ledger.json` holds the rows. A row is one observable Aider behavior contract.
- `coverage.json` maps every census unit to rows or to a non-claim.
- `../scripts/census.mjs` enumerates the units. Run `node scripts/census.mjs` for counts and `--json` for the full list.
- `../scripts/check-parity.mjs` is the gate.

## Census units

The census is mechanical, so nothing in the sources can be skipped silently.

- Document units are each paragraph, list item, table row, code block, and mermaid block of the four documents. Their ids look like `git/6-dirty-checkpoints-precede-assistant-writes/p2`. The middle part is the slug of the nearest heading. The letter is the unit kind (`p` paragraph, `i` list item, `r` table row, `c` code, `m` mermaid, `q` quote) and the number counts units inside that heading.
- Evidence units are recorded probe cases from the evidence directories, such as `ev-git/probe/inventory-semantics`.
- Aider test units are test functions in the pinned modules, such as `aider-test/test_editblock/TestUtils.test_replace_multiple_matches`.

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

An Aider test unit that checks in-scope behavior maps to the rows it checks, and a ported test carries the tag `[aider:<module>/<name>]` in its title. An evidence unit maps to rows, and its replay test carries `[evidence:<unit id>]`.
