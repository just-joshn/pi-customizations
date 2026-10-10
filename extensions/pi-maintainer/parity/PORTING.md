# Porting an Aider module to pi-maintainer

Use this recipe for every Aider algorithm that moves to TypeScript. The oracle is the contract. A port is done when Aider's own Python and the TypeScript produce identical outcomes on every case, and the cases cover every branch of the Aider source.

## Steps

1. Read the Aider module in full at `/Users/josh-desktop/src/experiments/aider` (pinned commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`). Read the Aider tests for it in `tests/basic/`. Read the section of the reconstruction document that covers it.
2. Add oracle operations in `parity/oracle/ops/<area>.py`. Each wraps one Aider function with `@op("<area>.<function>")`, takes JSON `args` and the case directory, and returns JSON. Convert tuples to lists and paths to strings. Do not catch exceptions; the driver records them as `{"error": {"type", "message"}}`. Keep Python functions under 50 lines and nesting under 5 levels.
3. Write cases in `test/oracle/<area>.cases.json`, a JSON array of `{ "id", "op", "args" }`. Derive them from every branch of the Aider source, every Aider test for the module, and the reconstruction's probes. Include empty input, missing trailing newline, CRLF, tabs, Unicode outside the BMP, duplicate matches, and every error path. Case ids are `<function>/<scenario>`.
4. Capture goldens with `node scripts/capture-oracle.mjs <area>`. Never edit a golden by hand.
5. Port to TypeScript under `src/`. Mirror Aider's function boundaries and names in camelCase so a reviewer can read the two side by side. Use `src/support/pystr.ts` for Python string semantics (`splitlines`, `strip`, `split()`, `count`, `replace`, `expandtabs`) instead of JavaScript's `trim`, `split`, or `\s`, which treat whitespace and line breaks differently. Throw `ValueError`, `DiffError`, or `SearchTextNotUnique` from `src/edit/errors.ts` with Aider's exact message where Aider raises. Touch the filesystem only through `WorkingTree` in `src/edit/working-tree.ts`.
6. Write `test/<area>.oracle.test.ts`. For each operation, `test.for(oracleCases('<area>', '<op>', schema))('<function> $id', ...)` and assert `expect(await outcomeOf(() => port(args))).toEqual(expected)`. Look at `test/pystr.oracle.test.ts`.
7. Port each Aider unit test for the module into `test/<area>.test.ts` with a behavior-named title under 72 characters and `{ meta: { aider: ['<module>/<Class.test_name>'] } }` naming the Aider test it ports (the census id after `aider-test/`). Assert literal expected values.
8. Prove the oracle bites. Temporarily break one branch of the port and confirm a test fails, then restore it.

## Code rules

The repository's checks enforce these, and a violation fails review.

- Functions are at most 50 code lines, control flow nests at most 4 levels, files stay under 400 lines where possible and never exceed 800.
- Never write into a parameter's fields or elements. Build new values.
- No `any`, no `as` casts outside a validated boundary, no non-null assertions, discriminated unions for variants.
- No `console.log` in `src/`. No empty `catch`.
- Comments only for a non-obvious reason the code cannot show, such as a deliberate copy of an Aider quirk.
- Python and JavaScript differ in ways that change results. `len` counts code points, JavaScript `length` counts UTF-16 units. Python `re` and JavaScript `RegExp` differ in `\s`, `$`, and `\b` around Unicode. Python slicing never throws. Python's `difflib` and `diff_match_patch` have exact algorithms you must reproduce, not approximate.
- A documented Aider defect is fixed only when the parity ledger records it as a `fix` row. Until then, reproduce Aider exactly and say in your report which behavior looked defective.

## Verify before reporting

From `extensions/pi-maintainer`: `bun x vitest run`, `bun x tsc -p .`, then from the repository root `bun x biome ci extensions/pi-maintainer --error-on-warnings`, `node scripts/check-agents-compliance.mjs | grep pi-maintainer` (must print nothing), and `node extensions/scripts/check-vitest-conventions.mjs | grep pi-maintainer` (must print no errors).
