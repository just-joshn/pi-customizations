# u-dep-consumer-journeys-001 report

## Verdict

One tools consumer matrix row closed with a linked Cursor+Pi pair. Five rows stay open. Ledgers were not edited.

## Predicate

At least one named consumer journey row closed by a linked Cursor+Pi pair with attempt IDs and real PTY both sides, or an exhaustive-negative that the host cannot run it.

**Result.** VERIFIED for row `npm:commander@14.0.0` via `orch/orch.ts` (`orch --help`).

## Closed row

| Field | Value |
| --- | --- |
| Package | `npm:commander@14.0.0` |
| Activation | runtime |
| Consumer | `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts` |
| Consumer sha256 | `f091687df627a0b75fabd54af58945a9cd6c7039ef0622012ac9ed60cd8ec434` |
| Pair path | `parity/evidence/consumer/pair-consumer-orch-help-1.json` |
| Cursor attempt | `076e12b0-fbfa-4ce8-be13-bc846be2c7cb` |
| Pi attempt | `18ec805b-5b5c-4fbe-ae62-a3894eefedde` |
| Oracle | Settled screens show `Usage: orch` and `Commands:` with `init` plus `unit`/`standing`; done marker `EXIT=0`; consumer hash matches locked digest |

Both hosts ran `bun run orch/orch.ts --help` in the locked tools cwd under the PTY recorder. Cursor screen shows the shell tool output. Pi events show `$ bun run orch/orch.ts --help; echo "rc=$?"` before the pasted help text.

## Still open

| Package | Activation | Consumer / note |
| --- | --- | --- |
| `npm:commander@14.0.0` | runtime | `watch-pr/cli.ts` |
| `npm:bun-types@1.3.14` | test/typecheck | `package.json` scripts.test / bun-types |
| `npm:typescript@7.0.2` | typecheck | `package.json` scripts.typecheck |
| `source-tools-bootstrap` | install | frozen install + restart after install-key change |
| `npm:bun-types@1.3.14` | test | `bun test orch watch-pr` under locked bun-types |

Local wave-009 smokes (orch help, typecheck, bun test) remain non-closing by themselves.

## Artifacts

| Kind | Path |
| --- | --- |
| Capture lever | `parity/scripts/capture-consumer-orch-help.mjs` |
| Rejudge lever | `parity/scripts/rejudge-consumer-orch-help.mjs` |
| Pair | `parity/evidence/consumer/pair-consumer-orch-help-1.json` |
| Research pointer | `parity/research/dep-closure-wave-009/consumer/paired-orch-help.json` |
| Decision trail | `parity/evidence/consumer/.audit/u-dep-consumer-journeys-001.tsv` |

## Notes for the coordinator

- `pairClosed` is true after rejudge. The first capture pass used `\bCommands:\b`, which fails after a colon, so `journeyClosed` was false until the same screens were re-observed.
- Prefer next pair on `bun run typecheck` if the goal is typescript consumer activation, or `watch-pr --help` for the second commander consumer.
- Do not claim the full six-row matrix closed. Count is 1 closed, 5 open.
