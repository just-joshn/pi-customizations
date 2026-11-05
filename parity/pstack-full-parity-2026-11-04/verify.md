# Verify review

## Scope

This pass checks the changed shell-monitor behavior through deterministic component comparisons, real subprocesses, and actual Pi CLI and RPC entry points. The same assistant performed implementation and review. This is not an independent external review.

## Reproduction before fixes

`.audit/pstack-full-parity-2026-11-04/shell-regression-baseline.txt` records three failing real-Pi cases against the old shell runtime. Progress did not arrive before a newline or exit. Three matches in one chunk produced too few notices. The match limit and limit notice were absent.

`.audit/pstack-full-parity-2026-11-04/shell-invalid-watch-baseline.txt` records a later, separate failing pass. Empty patterns produced unwanted progress. Malformed and oversized patterns prevented command execution instead of following the original factory fallback. The whitespace case already passed.

`.audit/pstack-full-parity-2026-11-04/package-tests.txt` records an introduced cold-install regression. Eagerly importing the new dependency prevented fresh local copies from loading. The correction preserves extension loading and adds a test that a requested valid watch fails before command execution if its engine is missing. Existing installation assertions were not weakened.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Original observer comparison | Passed 18 named scenarios with step-by-step output checks. | `extensions/pi-pstack/test/fixtures/cursor-shell-monitor.json` and `test/shell-output-watch.test.ts`. |
| Original factory failure policy | Passed four named cases through Pi JSON. | Same fixture and `test/e2e/background-shell.e2e.test.ts`. |
| UTF-8 stream separation | Passed a gated subprocess case with split characters on both stdout and stderr. | `test/background-shell.test.ts`. |
| Cold install and focused regression suite | Passed 47 tests across four files after the dependency-loading correction. | `.audit/pstack-full-parity-2026-11-04/package-treatment.txt`. |
| Package typecheck | Passed. | The package-treatment command and root gate log. |
| Full pi-pstack suite with V8 coverage | Passed 731 tests. Five existing tests were skipped. | `.audit/pstack-full-parity-2026-11-04/make-verify.txt`. |
| Installed Pi CLI and RPC | Passed 18 shell and package-install tests against the installed Pi launcher. | `.audit/pstack-full-parity-2026-11-04/final-installed-tests.txt`. |
| Command and mode regression drives | Passed. | `.audit/pstack-full-parity-2026-11-04/commands/` and `mode/`. |
| Actual installed lifecycle probe | Observed `ctx.signal` at `agent_end`, but not at `agent_before_settle` or `agent_settled`. | `.audit/pstack-full-parity-2026-11-04/lifecycle/result.json`. |
| Default-runtime root gate | Failed in unchanged pi-rea SQLite tests under Node 24.13.1. | `.audit/pstack-full-parity-2026-11-04/make-verify.txt`. |
| Supported-runtime root gate | Passed every `make verify` target with command-scoped Node 26.13.0. | `.audit/pstack-full-parity-2026-11-04/make-verify-node26-final.txt`. |

## Finding and disposition

The scoped monitor behavior passes its observed checks. The lifecycle probe does not reproduce a cancellation hang. It establishes only signal availability at those events.

Whole-plugin parity is `NOT VERIFIED`. These checks do not establish remote VM behavior, hosted triggers, Slack automation, IDE behavior, permission parity, restart and ownership behavior, or all dependency-supplied workflows.
