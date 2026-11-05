# Full pstack parity handoff

## Goal and verdict

The requested goal is 100% behavioral and functional parity between pi-pstack and the actual Cursor pstack plugin, including behavior supplied by reachable direct and transitive dependencies.

`NOT VERIFIED`. This work does not complete that goal. It establishes a pinned baseline, records an incomplete evidence-backed inventory, and fixes a bounded set of real shell-monitor mismatches. Material implementation and verification gaps remain.

The work-alone constraint was breached once. `cursor agent status` was intended as a status probe but launched another LLM. The operator was informed. That response is excluded from evidence, implementation decisions, and reviews. This run cannot be described as compliant with that constraint.

## Reference baseline

The target is installed pstack 0.15.36 at `ae5650febf4320793844c12c4adaa937f417f8da`. The local source checkout contains older pstack 0.15.9 and was rejected as the target.

The inspected upstream archive is `bb68f2365eceafa0cb2d253112f675acf5f144cc`. The captured comparison reports no pstack or cursor-team-kit changes across the intervening 14 commits. Every captured pstack file also matches the installed target cache by hash.

The host baseline is Cursor CLI 2026.10.22-27dcf5f and Pi 1.5.0. Cursor desktop is not installed on this host. Node 24.13.1 and Bun 1.4.4 were the initial runtimes. The starting repository revision is `0ab0b0c97699fafa31e462aecf8f3a5fdf3154ab`.

`baseline.json` records hashes and dispositions. The inventories capture 613 source files, 545 dependency-reference candidates, and 75 host factories. These counts are not behavioral coverage. `cursor-sdk` is recorded as an examined candidate, not an established transitive dependency.

## Implemented native changes

For users of background commands, a watched match can now wake Pi before the producer prints a newline or exits. Multiple occurrences within one chunk count separately. Later matches batch from the second occurrence. The monitor flushes at completion, stops at the default 100-occurrence limit, and sends the original limit notice.

The monitor now uses the identified `re2js` 1.2.2 dependency. It retains the original carryover and processing-slice rules, title fallback and truncation, oversized-match omission, minimum debounce, and single-deferred-occurrence wording.

Empty patterns create no monitor. Invalid and oversized patterns log a warning without stopping the real command, matching the original factory policy. A missing regex dependency is different. The extension still loads, but a valid requested watch fails before its command runs. This preserves existing Pi local-install behavior without silently dropping requested monitoring.

stdout and stderr have separate UTF-8 decoders. Split characters reach the monitor and output file intact.

For maintainers, `extensions/pi-pstack/src/shell-output-watch.ts` owns monitor lifecycle and batching state. `extensions/pi-pstack/src/background-shell.ts` keeps process and file ownership. The old completed-line buffer and timer functions were removed. No delegated-agent capability was removed. Production code does not invoke a Cursor backend for this change.

## Specification and architecture

`specification.md` records the 22 stable `SHELL-WATCH` behavior IDs, the stream and installation contracts, evidence classes, and unresolved requirements. `architecture.md` records ownership, serial design alternatives, dependency handling, and limits of the comparison.

The fixture generator executes the original checksum-checked observer and factory in isolation. It does not import pi-pstack. This is original-component execution, not a live Cursor workflow. The tests use the identified published regex dependency and controlled timer and registry boundaries.

## Verification

| Check | Result | Receipt |
| --- | --- | --- |
| First real-Pi regression baseline | Three failures reproduced before the shell-runtime change. | `.audit/pstack-full-parity-2026-11-04/shell-regression-baseline.txt`. |
| Invalid-watch regression baseline | Three failures reproduced in the later factory-policy pass. | `shell-invalid-watch-baseline.txt` in the same evidence directory. |
| Focused tests after cold-install correction | 47 passed across four files. | `package-treatment.txt`. |
| Full pi-pstack typecheck and V8 coverage suite | Passed. 731 tests passed and five were skipped. | `make-verify.txt`. |
| Final actual installed Pi entry-point suites | 18 passed across shell and package-install suites. | `final-installed-tests.txt`. |
| Commands and mode drives | Passed with actual CLI and RPC artifacts. | `commands/`, `mode/`, and their drive logs. |
| Fresh original fixture regeneration | Parsed data matches the checked-in fixture. | `regenerated-monitor.json` and the fresh-confirmation terminal receipt. |
| Separate seeded confirmation | 256 cases and 3,438 checkpoints match the original observer. | `confirm/result.json`, inputs, and original results. |
| Artifact fact-check | Passed its identity, integrity, uniqueness, change-scope, and incomplete-status assertions. | `fact-check.json`. |
| Installed lifecycle signal probe | Signal present at `agent_end`, absent at final-settle events. | `lifecycle/result.json`. |
| Default Node 24.13.1 root `make verify` | Failed in unchanged pi-rea SQLite tests because the required native limits API is absent. | `make-verify.txt`. |
| Command-scoped Node 26.13.0 root `make verify` | Passed every target, including all package suites, formal proof, provider checks, and fresh-install checks. | `make-verify-node26-final.txt`. |
| PR preparation after the pi.15 version bump | Passed 47 focused cases against installed Pi, the artifact fact-check, and the full root gate under Node 26.13.0. | `pr-focused-tests.txt`, `pr-fact-check.json`, and `pr-make-verify.txt`. |

The Pi entry-point suites use an offline scripted model. Their child Pi processes are deterministic test processes, not delegated LLM workers. Source or test counts are not a percentage of plugin behavior covered.

## Separate reviews

`verify.md` checks the changed behavior through actual Pi entry points and real subprocesses. `confirm.md` checks separate seeded inputs against the original component. `fact-check.md` rechecks identities, provenance, counts, scope, and claims.

All three passes were performed by the same assistant with separate deterministic checks. No independent external-review claim is made. The mistaken Cursor assistant response was not a reviewer.

The review caught an introduced cold-install failure and a duplicate dependency-reference ID. Both were corrected without weakening the failing assertions.

## Material gaps

| Gap | Disposition |
| --- | --- |
| Remote cloud workers | Known implementation mismatch. Current Pi environment `cloud` creates a local process and worktree, not the VM described by the reference. |
| Hosted timers, PR triggers, and webhooks | Local supervision and loopback endpoints do not establish hosted availability, reachability, isolation, or lifecycle equivalence. |
| Benny Slack automations | Trigger setup, trusted triage markers, thread coordinates, permissions, and issue and draft-fix workflows have not been verified against configured services. |
| Desktop and hosted reference execution | The IDE is absent locally. Hosted and account-dependent workflows were not exercised. |
| Lifecycle and cancellation | Session ownership, switch and restart behavior, concurrency, crash paths, and final-settle cancellation remain incomplete. The signal probe does not reproduce or fix a hang. |
| Full shell executor | Sandbox and approval policy, output limits, truncation, backpressure, non-default watch configuration, and handoff races remain open. |
| Dependency and workflow closure | Candidate references are not a closed graph. Not every skill, script, host capability, conditional route, failure, or transitive executable has a reconstructed contract and native proof. |
| Review independence and process compliance | No independent reviewers were used. One mistaken command violated the explicit no-other-LLM constraint. |

No missing capability has been declared equivalent by renaming a local substitute or by adding a prompt instruction.

## Repository state

At the initial handoff, changes were uncommitted and no PR was open. The later PR preparation packages the shell-monitor fixes and audit as pi-pstack 0.15.36-pi.15. No merge, deployment, external customer message, or global runtime change was made. The Node 26 verification selects its runtime only for that command. Raw evidence remains in the ignored `.audit/pstack-full-parity-2026-11-04/` directory. Replay scripts and source inventories are in this audit directory.

## Decision principles

Foundational Thinking led to pinning the actual installed reference and reading Pi APIs before implementation. Model the Domain led to a bounded monitor with explicit lifecycle and batch ownership. Fix Root Causes led to replacing completed-line matching instead of patching workflow prompts. Prove It Works led to original-component comparisons, actual Pi entry-point checks, and the `NOT VERIFIED` whole-plugin verdict.
