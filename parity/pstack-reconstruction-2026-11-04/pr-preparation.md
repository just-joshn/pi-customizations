# PR preparation

Package the native Pi reconstruction repairs on a new branch with focused commits and a pull request. This request does not complete the remaining reconstruction milestones.

The branch is `fix/pstack-native-reconstruction`. A fetch confirmed that its starting point and `origin/main` both name `c6a73af5`. The related working-tree changes stayed in the existing checkout when the branch was created. No unrelated work was stashed, reset, or removed.

## Commit order

1. Serialize Task stale-lock recovery with the existing subscription lease mechanism.
2. Preserve loop prompt text and independent schedules.
3. Persist reviewed plan todos, dependencies, and worker handoff state.
4. Block host Unix sockets and test the limits of readonly credential isolation.
5. Correct Benny's credential gate and the canvas browser instructions.
6. Enable the supported Linux worktree-audit tests.
7. Record the reconstruction evidence, current verification failure, and remaining gaps.
8. Bump pi-pstack to `0.15.36-pi.13` after the user's version follow-up.

The first six commits keep the runtime, instruction, and test changes separate from the audit archive. The seventh commit includes the package documentation and evidence. The original preparation did not bump the package version. The later version follow-up bumps pi-pstack from `0.15.36-pi.12` to `0.15.36-pi.13` and updates the lockfile, changelog, and parity status. This PR changes no other extension. The captured `-pr` inventories and test receipts retain the source identity from before that metadata-only follow-up.

## Throughput checkpoint

The work already exists. This pass reviews the changed runtime and tests, runs the focused suites, repeats full verification, and publishes the ordered commits. No further parity implementation or host-security workaround belongs in this packaging pass. The user prohibited subagents, so all review and Git operations run locally in the coordinator.

## Fresh verification

The version-only follow-up passes `test/resources.test.ts` and `test/e2e/package.e2e.test.ts` with 18 tests. Frozen-lockfile installation, pi-pstack typecheck, lint, and toolchain checks also pass. Full verification was not rerun for the metadata change. The five readonly-shell failures remain unresolved.

Every focused test invocation below starts with `bun run --filter @justjoshn/pi-pstack test`. These checks ran on the complete worktree before the commit split. They are not isolated clean-checkout checks of each intermediate commit.

| Arguments | Result | Receipt |
| --- | --- | --- |
| `test/records.test.ts test/durable-store.test.ts` | 52 passed | `pr-process-lock-suites.txt` |
| `test/loop.test.ts` | 56 passed | `pr-loop-suite.txt` |
| `test/plan.test.ts test/todo.test.ts test/e2e/plan.e2e.test.ts test/e2e/package.e2e.test.ts` | 51 passed | `pr-plan-package-suites.txt` |
| `test/readonly-shell-dependency.test.ts test/e2e/task.e2e.test.ts -t 'Unix socket\|environment credentials'` | 3 passed, 58 unselected | `pr-readonly-boundary.txt` |
| `test/scripts.test.ts` | 15 passed | `pr-script-suite.txt` |

`make verify` exits 2. Its pi-pstack coverage suite reports 680 passing tests and five failing tests across 46 files. `pr-make-verify.txt` retains the full output. Lint, mechanisms, toolchain, test conventions, and pi-pstack typecheck pass before that stop. The run does not reach later packages, so it establishes no current result for them.

The five failures require successful restricted shell execution. They cover shared-manager policy, dependency-default write paths, inherited shell startup hooks, shutdown after shell use, and a child's legitimate `git log` operation. The strict helper fails at `/proc/self/setgroups` on this Linux host. Those positive assertions remain intact. The passing socket-denial test establishes failure-closed behavior here, not a usable restricted shell.

`node parity/pstack-reconstruction-2026-11-04/sandbox-strict-probe.mjs` still exits 1 with that namespace refusal. `sandbox-strict-probe-pr.txt` records the diagnostic without printing the credential-bearing wrapper command. No global host security setting was changed.

## Local review

The changed runtime diff, changed test diff, shared process-lock module, and new fixtures received a direct local pass. The pass covered loop lifecycle, stale-lock recovery, reviewed metadata, one-time worker import, branch restoration, readonly non-synchronization, process cleanup, and test resource cleanup. No application-code cleanup was needed after that pass. No new `.only`, lint suppression, type suppression, or `any` cast was found in the changed tests.

The prescribed independent Comment Sicko pass was not run because the user prohibited subagents. The local comment pass found no added comment that needed removal. No comments were deleted or restored during PR preparation. No constraint encoding or architecture change was proposed. This is not an independent review or a whole-system audit.

The authored changes pass `git diff --check`. An unrestricted check flags whitespace in captured patches and text receipts. Those captures retain their whitespace. The authored-file check excludes this audit directory's `*.patch`, `*.txt`, and `*.jsonl` captures.

## Publication review

A credential-pattern scan found generated localhost proxy authentication in two sandbox failure receipts. The published receipts replace those values in HTTP, SOCKS, SSH, and Cloud SDK configuration. Their failure diagnostics remain unchanged. The originals stay outside the repository in the current agent store with owner-only permissions. `pr-receipt-redactions.json` records the original and published hashes. `pr-secret-scan-baseline.json` retains the initial findings without matched values.

The scan also checks that the known original proxy values occur nowhere in the publication set. `pr-secret-scan.json` records its expressions, scope, and findings. A pattern scan is not proof that every possible sensitive string is absent.

The strict sandbox probe now prints captured stderr rather than the entire failed command. This avoids repeating the generated authentication in future namespace-failure receipts. Screenshots remain local under the repository's existing media ignore rule. The committed fixture observations and rerunnable browser probe retain the browser evidence.

Origin is not installed, so GitHub operations use `gh`. No force push, deployment, package publication, or merge is requested.

## Remaining limits

`review-checkpoint.md` records the unresolved workflow and schema review, TodoWrite schema discrepancy, Benny trigger timestamp mismatch, readonly host limitation, and unobserved authenticated or hosted journeys. Historical green receipts predate the socket hardening. They are not verification of the current source. This PR does not claim complete Cursor parity.
