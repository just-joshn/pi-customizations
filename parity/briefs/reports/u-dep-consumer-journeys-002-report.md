# u-dep-consumer-journeys-002 report

## Verdict

Two tools consumer matrix rows closed with linked Cursor+Pi pairs. Matrix after this unit is 3 closed, 3 open. Ledgers were not edited.

## Predicate

At least one additional named consumer journey row closed by a linked Cursor+Pi pair with attempt IDs and real PTY both sides, or honest blockers.

**Result.** VERIFIED for two rows: `npm:typescript@7.0.2` via `bun run typecheck`, and `npm:commander@14.0.0` via `watch-pr/cli.ts` (`bun run watch-pr/watch-pr --help`).

## Newly closed rows

| Field | Typecheck | Watch-pr help |
| --- | --- | --- |
| Package | `npm:typescript@7.0.2` | `npm:commander@14.0.0` |
| Activation | typecheck | runtime |
| Consumer | `.../scripts/package.json` | `.../scripts/watch-pr/cli.ts` |
| Consumer sha256 | `d1f815091209d49763775cc188e8e06ff32d5fec648bffd2272bc25a165e87c3` | `89c08863089181a232be782c4b2ed90a1552f44aeecb0dcb7aac2c623620e680` |
| Pair path | `parity/evidence/consumer/pair-consumer-typecheck-1.json` | `parity/evidence/consumer/pair-consumer-watch-pr-help-1.json` |
| Cursor attempt | `7aecba32-e4a1-49a3-b9cd-63e418d531ac` | `fb68af79-fb9e-4e2e-b665-f01ed3cdede2` |
| Pi attempt | `08917c07-ed54-41ac-86df-6586133d009d` | `bbb6f903-9a40-46a1-9f97-50d5ed85512e` |
| Oracle | Settled screens show `tsc --project watch-pr/tsconfig.json --noEmit --strict` with no `error TS`; done marker `EXIT=0`; consumer hash matches locked digest | Settled screens show `Usage: watch-pr` and `Options:` with `--owner`; done marker `EXIT=0`; consumer hash matches locked digest |

Both hosts ran the named command in the locked tools cwd under the PTY recorder. `pairClosed` is true for both pairs on first capture.

## Counts after this unit

| Status | Count |
| --- | --- |
| Closed | 3 |
| Open | 3 |
| Newly closed this unit | 2 |

Prior closed row (unchanged): orch `--help` pair `consumer-orch-help-1`.

## Still open

| Package | Activation | Consumer / note |
| --- | --- | --- |
| `npm:bun-types@1.3.14` | test/typecheck | `package.json` scripts.test / bun-types |
| `source-tools-bootstrap` | install | frozen install + restart after install-key change |
| `npm:bun-types@1.3.14` | test | `bun test orch watch-pr` under locked bun-types |

## Artifacts

| Kind | Path |
| --- | --- |
| Capture lever (typecheck) | `parity/scripts/capture-consumer-typecheck.mjs` |
| Capture lever (watch-pr) | `parity/scripts/capture-consumer-watch-pr-help.mjs` |
| Pair (typecheck) | `parity/evidence/consumer/pair-consumer-typecheck-1.json` |
| Pair (watch-pr) | `parity/evidence/consumer/pair-consumer-watch-pr-help-1.json` |
| Research pointer (typecheck) | `parity/research/dep-closure-wave-009/consumer/paired-typecheck.json` |
| Research pointer (watch-pr) | `parity/research/dep-closure-wave-009/consumer/paired-watch-pr-help.json` |
| Matrix | `parity/research/dep-closure-wave-009/consumer/journey-refresh.json` |

## Notes for the coordinator

- Entry for watch-pr help is `bun run watch-pr/watch-pr --help`. Direct `bun run watch-pr/cli.ts --help` prints nothing because `cli.ts` has no top-level main when run as a script.
- Do not claim the full six-row matrix closed. Count is 3 closed, 3 open.
- No ledger edits. No commit.
