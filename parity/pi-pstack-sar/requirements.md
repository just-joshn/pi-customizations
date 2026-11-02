# SAR requirement map

## Reference and interpretation

The reference is `/Users/josh-desktop/Documents/pstack-sar-report.md`, SHA256 `73aa9560364fe2efccb7943bd287f9dad65b441234bf6e2302bec0dd4a19e8d3`.

The report describes pstack 0.15.36 from source revision `ae5650febf4320793844c12c4adaa937f417f8da`. Its last pstack change is `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`.

The report is an architecture reconstruction, not an executable acceptance specification. Its labels explicitly distinguish observations, inferences, and unknowns. This map does not convert an unknown into a verified requirement or reproduce a known host defect.

## Report sections

| Section | Pi implementation or disposition | Verification |
| --- | --- | --- |
| 0, 2 | Evidence method and scope belong to the report, not extension runtime behavior. | Preserve report identity above. Record checks with their limits. |
| 1 | Summary of capabilities, dependencies, known defects, and distribution. | Expanded rows below and bundled inventory. |
| 3 | Pi is the host. Local processes and tools provide the executable layer. External services remain external. | Pi mechanism check and real RPC drives. |
| 4 | `package.json` declares Pi resources and publishes full source provenance. Runtime needs no source checkout. | `test/resources.test.ts` and `check-inventory.mjs`. |
| 5.1 through 5.3 | Bundled skills retain the router, 23 playbooks, principles, workflow skills, and path-based invocation. | Resource inventory, invocation tests, semantic content review. Model compliance is not guaranteed by installation. |
| 5.4 | `src/task/agents.ts`, `tool.ts`, and `runner.ts` implement delegate types and background behavior. | Agent, schema, runner, fork, status, and worktree tests. |
| 5.5 | `src/rule.ts`, `sections.ts`, and `task/models.ts` use the Pi agent directory and available provider models. | Rule/model tests. Default model availability remains account-dependent. |
| 5.6 | Team-kit resources and attribution are bundled. | Resource inventory and license checks. |
| 5.7 | Benny remains a dormant file pack. Pi subscriptions run its automation prompts. Slack and tracker access require external MCP configuration. As identified in the resource audit (F1-F3), timer sweeps use a finite lookback window (default 180m) taking one report per fire, the ledger relies on time-based stale claim expiration rather than active worker process probes, and readonly workers disable MCP/network writes but do not filter session environment variables. Live Slack integration is not established by these checks. | Resource tests, setup instruction review, and semantic resource audit. |
| 6.1 through 6.2 | The bundled statechart compiler, process supervisor, janitor, TLC resolver, and compiler passes are preserved. | All 367 statechart tests pass with real TLC 1.7.4 and Temurin 25. No TLC cases skip. |
| 6.3 | Bundled watch-pr, check-plan, and read-only worktree audit remain available from the package. The audit reads Pi transcripts. | Script tests run the 61-test Bun suite and installed script entry points. |
| 6.4 | `log.sh` retains TSV sanitation and formula-injection prevention. | Script tests. |
| 6.5 | Both executable suites have explicit entry points. Published archives exclude nested installed dependencies while retaining all skills and launchers. CI installs a checksum-pinned TLC JAR and executes statechart tests. | Local suite output and workflow review. CI execution itself is not claimed without a run. |
| 7.1 | `pi install` and `package.json.pi` replace Cursor marketplace loading. | Fresh-install checks and real RPC resource discovery. |
| 7.2 | Router, model rule, todos, delegates, tools, and loop form the same workflow sequence in Pi. | Resource tests, real command/mode drives, and existing workflow scenarios. |
| 7.3 through 7.4 | Compiler and watcher process/data flows remain bundled. | Executable suites and source inventory. GitHub production access is a separate external check. |
| 8 | Each host expectation H1 through H24 is classified below. | No Cursor host implementation is inferred from Pi tests. |
| 9 | External toolchain and model/service dependencies are retained where used. Pi supplies its own host libraries through wildcard peers. | Frozen workspace lock, mechanism check, actual TLC execution. Host binary signatures are report observations, not package promises. |
| 10 | Pi package distribution is independent. Passive source provenance does not create runtime sync. Cursor and Claude distribution channels are not Pi package features. | Package metadata, fresh install, bundled inventory, and CI configuration. |
| 11 | Preserve process separation, checksum controls, sandbox failure behavior, atomic outputs, and input sanitation. | Script, readonly-security, RPC, and subscription tests. Host Electron fuses do not apply to Pi. |
| 12 | Findings F1 through F12 are classified below. | No historical defect is counted as a required behavior. |
| 13 | Unknowns remain unknown unless a check in this run resolves the specific question. | TLC 1.7.4 on Temurin 25 is resolved locally by the complete statechart suite. Cursor internals and unobserved remote services remain outside this run. |
| 14, appendices | Question checklist and prior evidence ledger describe report coverage and reproduction. | Keep source/report identities. This run does not claim to have re-created REA's historical observations. |

## Host expectations

| ID | Native Pi mechanism or explicit difference |
| --- | --- |
| H1 | `package.json.pi.extensions` and `pi.skills` replace Cursor manifests. |
| H2 | npm package description and keywords replace ignored marketplace metadata. |
| H3 | The logo asset is preserved. Pi has no equivalent Cursor slash-menu logo contract. |
| H4 | Pi loads skills. Extension aliases expose bare slash names. Playbooks remain path-loaded files. |
| H5 | Pi's `disable-model-invocation` retains hidden workflow skills and explicit command access. |
| H6 | Mode UI reads icon/color from skill metadata. Cursor menu rendering is not copied. |
| H7 | TypeScript paths remain inert metadata, matching the report's observed lack of activation. |
| H8 | Task loads bundled subagent definitions. Exact advertised names work. Cursor name normalization is a host-specific compatibility detail. |
| H9 | Pi Task implements a background default from the delegate definition. It preserves pstack's intent instead of Cursor's ignored field. |
| H10 | No model/tools stripping is needed. Pi controls Task's child loadout and resolves models explicitly. |
| H11 | Task exposes the named fields through a TypeBox tool schema and Pi RPC children. |
| H12 | Task enforces readonly tool access and sandboxed shell execution. It does not reproduce Cursor's schema omission. |
| H13 | Task forks Pi sessions and can truncate copied user turns. It does not reproduce Cursor's schema omission. |
| H14 | AskQuestion uses native Pi dialogs and RPC UI. |
| H15 | TodoWrite persists branch-sensitive data with Pi custom entries and renders a widget. |
| H16 | Loop uses Pi lifecycle events and native continuation messaging. |
| H17 | Structured system-prompt sections inject the model rule independently of workspace ancestry. |
| H18 | Pi session files and subagent transcripts support recall. Pi does not impose Cursor's 30-day deletion policy. |
| H19 | Pi tools plus the durable supervisor implement timers, polling, and authenticated localhost webhooks. Cursor's hosted triggers (Slack, Linear, Sentry, CI) have no native Pi equivalents; Pi provides timers, GitHub polling with `gh`, and local webhook routines with bearer authentication. Hosted push events require an external relay or periodic timer sweep. A transactional workspace registry owns lifecycle and pending events. Exact owners drain through native Pi messaging. Five real installed-Pi scenarios cover idle wakes, busy follow-ups, offline owner resume, live Task notifications, and explicit offline fresh work. |
| H20 | Existing PR-side Bugbot threads remain external GitHub data. Pi cannot supply the Cursor Bugbot cloud service. No fake Bugbot agent is introduced. |
| H21 | Pi Task's cloud option uses local git worktrees. This isolates tracked source, not machines, ports, caches, simulators, or processes. Full remote VM equivalence is not established. |
| H22 | `/mode` persists and injects a skill on each run. Cursor's Option+Enter binding is not a Pi binding. |
| H23 | `pi install` replaces `/add-plugin`. |
| H24 | The report says plugin-root substitution is unused. Pi supplies package and skill paths directly. |

## Report findings

| ID | Disposition |
| --- | --- |
| F1 | Pi implements readonly and fork directly. |
| F2 | Pi Task honors background defaults and explicit call-site overrides. |
| F3 | Team-kit resources and MIT attribution are bundled. |
| F4 | Rule injection uses the actual Pi agent directory. Workflow instructions now read the model-rule path named in the system prompt rather than assuming the default directory. |
| F5 | Watcher tests run through the package script test. Statechart tests now have a CI step with real checksum-pinned TLC. Actions, Node, Bun, and Java are pinned in the workflow. Documentation links are validated by RES-007; full cross-file slash name and agent count assertions are maintained by the resource suite. No Cursor manifest schema is needed. |
| F6 | Unsupported frontmatter lives under Agent Skills metadata rather than being presented as a working Pi feature. |
| F7 | Multi-phase-plan uses `<SKILLS>/poteto-mode/scripts/check-plan.mjs`. |
| F8 | Watch-pr's first-run frozen dependency install remains documented. No offline guarantee is added. |
| F9 | The complete 367-test suite passes with the report's TLC checksum and Temurin 25. The JAR remains unsigned, with checksum integrity only. |
| F10 | Userland probing remains. Xcode/simctl, Deno, Origin, Slack, and Tailscale remain optional external requirements for workflows that use them. |
| F11 | Pi retention differs intentionally. No user transcript deletion is introduced. |
| F12 | The published package now records both full source commits in `pstackSource`. |

## Verdict rules

A file hash proves preservation, not runtime behavior. A unit test proves its asserted contract, not a remote service. A local worktree is not a remote VM. An unexecuted CI configuration is not a green CI run. Owner delivery, workspace management, stale restore, once lifecycle, readiness, repeated identical POSTs, persistence errors, and crash recovery now have passing checks. Literal parity with every host identity and unresolved fact in the report remains an unsupported claim.

## Verification record

| Check | Result and evidence |
| --- | --- |
| Complete package suite | 538 tests across 39 files passed on final source. `evidence/package-final-parent.txt`. |
| Package types | `bun run --cwd extensions/pi-pstack typecheck` passed. `evidence/typecheck-final.log`. |
| Real installed Pi 1.4.0 subscriptions | All five scenarios passed on final source with `PI_BIN` and `PI_VER` logged. `evidence/subscription-installed-parent.txt`. |
| Transaction and process-death tests | Acceptance before and after atomic replacement, dead writer recovery, cancellation ordering, and enqueue-before-ack replay passed. `evidence/transactions-crash.log`. |
| Real command and mode drives | Doctor and both drives passed. The final command count is 117. Saved results are `artifacts/pstack-sar-final/commands/` and `artifacts/pstack-sar-final/mode/` at the repository root. |
| Statechart compiler and real TLC | All 367 tests passed with zero skipped. `evidence/statechart-final.txt`. |
| Shipped resources and sections | All 22 tests passed. `evidence/content-tests.txt`. A fresh child also read all ten hidden Benny dependency files from its installed SKILLS path. |
| npm distribution and fresh install/remove | Both package E2E tests passed. `evidence/package-distribution.txt`. The packaging regression fails without `skills/.npmignore`, as recorded in `evidence/package-distribution-before.txt`. |
| Source inventory | 497 identical files, 72 changed files requiring semantic interpretation, four documented host-specific omissions, and zero missing files or executable-bit mismatches. `evidence/inventory-final.json`. Hashes do not prove semantic equivalence. |
| Pi mechanism checker | Passed in the parent run. Baseline saved output is `evidence/pi-mechanisms.txt`. |
| Changed-code formatting and lint | Scoped Biome checks and `git diff --check` passed. |
| Repository-wide gate | `make verify` remains blocked by unrelated repository diagnostics. `evidence/root-verify-final.txt` has no diagnostics for pi-pstack or this audit directory. Existing test-convention and TypeScript-policy failures are separately recorded in `evidence/test-conventions.txt` and `evidence/types-policy.txt`. |

## Remaining environmental limits

- Local worktrees preserve separate tracked source and branches. They do not supply remote machine, port, process, cache, simulator, or credential isolation.
- Live Slack, external MCP workflows, hosted Bugbot, GitHub production events, Tailscale exposure, and the actual GitHub Actions run have not been established by local fixtures and tests.
- Model compliance with all prose workflows is not guaranteed by installing or reading their files.
- GitHub restart takes a new baseline. Changes occurring entirely during downtime can be missed.
- Pi enqueue and durable acknowledgement are not atomic. Crash recovery can repeat a wake or fresh execution. Detached results expose status rather than live Task notifications.
- In-process fallback ends with its Pi process. Unsaved owning sessions cannot resume their parked backlog after process exit.
- Failed detached fresh runs are bounded at 5 retry attempts with exponential backoff (starting at 250ms); once attempts are exhausted or the subscription expires, retries halt and the error is preserved in `list_subscriptions`.
- Pending events are capped at 20 per subscription to prevent unbounded storage growth and resume flooding during extended offline periods.
- In-process fallback supervisor isolates session execution to its own session ID, not running foreign tasks locally.
- Benny timer sweeps scan a finite lookback window (`SWEEP_LOOKBACK_MINUTES`, default 180m) taking one report per fire; reports during extended offline periods exceeding lookback are not preserved unless relayed via webhook. Benny ledger claims rely on elapsed time rather than worker process monitoring.
