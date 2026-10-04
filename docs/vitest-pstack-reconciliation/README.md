# Vitest and pstack merge resolution

This resolution combines the Vitest migration in PR #59 with pstack source parity from PR #60 and the Origin installer correction from PR #58.
Pstack source and behavior take priority where the changes conflict.

## Source ownership

The preserved pstack source, team-kit source, generated skills, and prompt templates match main at `03ce27f` byte-for-byte.
The comparison covers 401 files.
The main generator verifies 190 preserved files and 211 generated resources.
The source checker verifies 161 normalized pstack files against its pinned authority.

Main intentionally removes older orchestration, watcher, and instruction-policy overlays.
This resolution retains those deletions.
The branch's machinery for rewriting source snapshots is removed because it contradicts main's source-fidelity contracts.
Maintained tests retain the compatible Vitest, fixture, cleanup, and strict-type changes from the branch.

## Compiler boundary

Root compiler flags remain unchanged.
Preserved native source belongs to its original project rather than the repository's maintained-code policy.
The maintained helper-test project also checks the native helpers that its tests import.
That project disables only `erasableSyntaxOnly`, `noPropertyAccessFromIndexSignature`, and `noUncheckedIndexedAccess`.
Its other compiler flags still match the root policy.

An isolated import probe showed that discovery exclusions alone cannot solve this conflict.
TypeScript applies the importing project's flags to the imported native helper.
The policy self-tests reject additional weakened flags and omitted maintained helper tests.
Biome and the format writer protect the preserved source and generated delivery.
An actual format-write run retained all 401 compared files.

## Test retention

All five new maintained test files from main remain.
The deferred-wake, delivered-content, field-name, and source-policy test files match main without edits.
The new helper source-fidelity test changes only its runner import and cleanup preload.
The new routine acknowledgement cases, TSV parser checks, and GitHub account and pagination regressions retain their assertions.

The AST comparison reports eight main titles that no longer appear verbatim.
Three compound store tests become focused tests with the same contracts.
Four network-dependent watcher tests retain their output and parsing contracts through the branch's deterministic CLI boundary fixtures.
One helper-test gate case uses Vitest instead of Bun.
The separate native Bun gate case remains.
[Test dispositions](test-dispositions.tsv) records each translated title and each obsolete overlay contract removed by main.
The AST comparison detects definitions, including parameterized titles.
It does not prove assertion or case-data equivalence by itself.

## Verification

The parent independently ran the following checks on the isolated resolved tree.

- All six workspace test suites passed. Pstack passed 2,209 tests with one intentional skip.
- Workspace typechecks, strict CI lint, agent compliance, toolchain checks, and test conventions passed.
- Installed Pi CLI verification passed without model calls. The RPC journey run passed 518 checks with zero findings.
- Resource generation and authoritative-source verification passed.
- The 401-file byte comparison passed.

An independent `deepseek/deepseek-v4-pro` review returned `PASS+NOTES`.
The reviewer checked assertions, parameterized cases, compiler boundaries, source bytes, and the decision trail.
It independently reran workspace tests, typechecks, lint, and both maintained and native helper tests.
Its sole remaining note is the inherited canvas CSS condition below.

The resolution worker also verified 395 maintained helper tests and native source helper coverage.
Its V8 run reported 80.26% statements, 81.26% branches, 82.01% functions, and 83.10% lines.
The configured Vitest discovery excludes preserved native Bun copies, not maintained helper tests.

## Repeatable comparisons

These scripts compare this resolution with the fixed pre-merge branch and main revisions.
They require those commits in local Git history and the repository's installed dependencies.

```sh
python3 docs/vitest-pstack-reconciliation/audit-source.py "$PWD" "$PWD"
node docs/vitest-pstack-reconciliation/audit-test-contracts.mjs "$PWD" "$PWD" > /tmp/vitest-pstack-test-contracts.json
```

The source audit exits nonzero for missing files, extra files, or changed bytes.
The AST report contains the main, branch, base, and candidate inventories and the missing-title lists.
The eight translated main titles require the assertion-level review described above.
These are historical reconciliation tools, not a requirement that future pstack updates keep the same source bytes.

## Known source condition

Main preserves a canvas CSS declaration spelled `reference: pointer`.
Chrome treats it as an unknown property and reports the default cursor.
The branch's source-rewrite correction is not retained because the resolution preserves main's authoritative bytes.
Functional canvas reopen, expand, and collapse checks remain.
This existing source condition is not presented as a corrected merge regression.

## Audit evidence

The local command logs, failed experiments, full decision trail, source comparisons, and review artifacts are under `/tmp/vitest-reconcile-01a10781/`.
The initial filtered upstream baseline forwarded Vitest files to Bun through a composite script and was discarded.
Separate Vitest and native-helper baseline commands passed afterward.
No source changes resulted from that invalid baseline.
The original branch stayed untouched throughout isolated implementation and verification.
