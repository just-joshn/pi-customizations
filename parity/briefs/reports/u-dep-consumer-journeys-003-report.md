# u-dep-consumer-journeys-003 report

## Verdict

Three remaining tools consumer matrix rows closed with linked Cursor+Pi pairs. Matrix after this unit is 6 closed, 0 open. `unresolvedReference` for this consumer family is ready to remove once the coordinator merges. Ledgers were not edited.

## Predicate

Close as many of the three remaining rows as honest PTY evidence allows, with real Cursor+Pi pairs both sides, or exhaustive-negative for host-blocked rows.

**Result.** VERIFIED for all three remaining rows. Two physical pairs. The bun-types `test/typecheck` row is not a distinct command from `test`.

## Newly closed rows

| Field | Bun-types test (+ test/typecheck) | Bootstrap install |
| --- | --- | --- |
| Package | `npm:bun-types@1.3.14` | `source-tools-bootstrap` |
| Activation | test (also closes test/typecheck) | install |
| Consumer | `.../scripts/package.json` | `.../scripts/bootstrap.ts` |
| Consumer sha256 | `d1f815091209d49763775cc188e8e06ff32d5fec648bffd2272bc25a165e87c3` | `ccd2ed08fd9da9d0d942e5f2491cfc74bb92d8a08fa51755e0da1ac8de287361` |
| Pair path | `parity/evidence/consumer/pair-consumer-bun-test-1.json` | `parity/evidence/consumer/pair-consumer-bootstrap-install-1.json` |
| Cursor attempt | `607e4ca2-6c4c-466c-9af5-e930f9b84fb8` | `86de8b3f-95da-47f3-ac6f-c2575543249f` |
| Pi attempt | `81a09133-81b4-46e9-8266-0c0617aab431` | `4d9f3f54-35b9-4b22-ab6c-936056420a67` |
| Oracle | Settled screens show `52 pass` and `0 fail` plus `Ran N tests across M files`; done marker `EXIT=0`; bun-types `1.3.14`; consumer hash matches locked digest | Forced install-key mismatch beforehand; settled screens show `Usage: orch` and `Commands:`; install-key rewritten to expected digest; commander present; done marker `EXIT=0`; bootstrap hash matches locked digest |

Both hosts ran under the PTY recorder. `pairClosed` is true for both pairs on first capture.

## Counts after this unit

| Status | Count |
| --- | --- |
| Closed | 6 |
| Open | 0 |
| Newly closed this unit | 3 |

Prior closed rows (unchanged): orch `--help`, watch-pr `--help`, typecheck.

## Distinctness note

`package.json` `"test"` is exactly `bun test orch watch-pr`. The matrix row with activation `test/typecheck` and locator `scripts.test / bun-types` is the same command as activation `test`. One pair closes both. No separate test/typecheck path exists beyond that script.

`watch-pr/tsconfig.json` lists `"types": ["bun-types"]`, so typecheck also loads bun-types, but that path already closed the typescript row and is not what the bun-types `test/typecheck` locator names.

## Bootstrap oracle note

`bootstrap.ts` writes install stdout only on failure. Success of `bun install --frozen-lockfile` after an install-key mismatch is proven by the key rewrite to `sha256(package.json + bun.lock)`, commander presence, and post-restart help chrome. Screens do not show an install banner on the success path.

## Artifacts

| Kind | Path |
| --- | --- |
| Capture lever (bun-test) | `parity/scripts/capture-consumer-bun-test.mjs` |
| Capture lever (bootstrap) | `parity/scripts/capture-consumer-bootstrap-install.mjs` |
| Pair (bun-test) | `parity/evidence/consumer/pair-consumer-bun-test-1.json` |
| Pair (bootstrap) | `parity/evidence/consumer/pair-consumer-bootstrap-install-1.json` |
| Research pointer (bun-test) | `parity/research/dep-closure-wave-009/consumer/paired-bun-test.json` |
| Research pointer (bootstrap) | `parity/research/dep-closure-wave-009/consumer/paired-bootstrap-install.json` |
| Matrix | `parity/research/dep-closure-wave-009/consumer/journey-refresh.json` |
| Decision trail | `parity/evidence/consumer/.audit/u-dep-consumer-journeys-003.tsv` |

## Notes for the coordinator

- All six consumer matrix rows are closed. Consumer-family `unresolvedReference` is ready to remove on ledger merge.
- No ledger edits. No commit.
