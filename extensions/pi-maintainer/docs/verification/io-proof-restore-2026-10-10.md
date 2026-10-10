# Inherited I/O proof restore, 2026-10-10

`56afd8cd` cleared `pi`, `src`, and `tests` on the four inherited OPEN I/O rows so E1 mapping could finish with empty proof arrays. Goal audit `goal-audit-2026-10-10.md` later required those pointers back for E1 retention, without treating the rows as verified.

Restored from the last filled snapshot `e0748bc7` on `pm/ledger`. Source and tests still exist in this package. Rows stay `open`.

| Row | `pi` | `src` | `tests` |
| --- | --- | --- | --- |
| `edit.io.read-text` | `[]` (reads do not enter `withFileMutationQueue`) | `src/edit/working-tree.ts` | `test/working-tree-read.oracle.test.ts::reads Aider text *` |
| `edit.io.write-text` | `withFileMutationQueue` | `src/edit/working-tree.ts` | configured line-ending and UTF-16LE write tests |
| `edit.io.write-retry-errors` | `withFileMutationQueue` | `src/edit/working-tree.ts` | missing-parent immediate OS-error report test |
| `edit.io.nonatomic-overwrite` | `withFileMutationQueue` | `src/edit/working-tree.ts` | `[]` (no owner test yet; contract remains open) |

Empty `tests` on `edit.io.nonatomic-overwrite` is intentional. No package test yet asserts that an earlier successful write survives a later failure. Filling a fake selector would be a false claim.
