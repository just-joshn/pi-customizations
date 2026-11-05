# Behavioral inventory and specification

## Status

This inventory is incomplete. It records established shell-monitor contracts and unresolved requirements discovered outside that unit. It is not a specification of 100% of pstack behavior.

The pinned target is Cursor pstack 0.15.36 at `ae5650febf4320793844c12c4adaa937f417f8da`. `baseline.json` records source, dependency, and installed Pi API identities. `source-inventory.jsonl` tracks captured files. `dependency-candidates.jsonl` tracks reference candidates, not a closed dependency graph. `host-modules.jsonl` records statically extracted factory identities.

A file hash proves identity, not semantic review. A passing Pi test proves its assertions, not Cursor equivalence outside those assertions. Historical parity reports supply neither a reference contract nor a fresh runtime observation.

## Evidence classes

| Class | Meaning |
| --- | --- |
| Source | The pinned reference explicitly defines the requirement. |
| Original component execution | The original shipped implementation runs in isolation with a pinned dependency and controlled timer boundaries. |
| Native process execution | A real subprocess produces the output and pi-pstack handles it. |
| Native entry-point execution | A real Pi CLI or RPC session executes the registered tool with a deterministic offline test model. |
| Inference | Source inspection suggests a requirement or mismatch that has not been observed end to end. |
| Unknown | The contract, implementation, or necessary access remains unresolved. |

## Established output-monitor contracts

These IDs appear in `extensions/pi-pstack/test/fixtures/cursor-shell-monitor.json`. The fixture generator executes the original observer and factory from Cursor CLI 2026.10.22-27dcf5f. It does not import pi-pstack. The local-exec factory SHA-256 is `9209baa549d98f4780aea681d99427808525faee764d3c847ecaaa20c6392ba7`. The regex engine is `re2js` 1.2.2, identified by Cursor's shipped license metadata.

| Behavior ID | Observable contract | Native verification |
| --- | --- | --- |
| SHELL-WATCH-001 | A match notifies before a newline or producer exit. | Original component comparison and Pi RPC. |
| SHELL-WATCH-002 | Every occurrence within one chunk counts. | Original component comparison and Pi JSON. |
| SHELL-WATCH-003 | A match can span successive chunks. | Original component comparison. |
| SHELL-WATCH-004 | Carryover text does not recount an already complete match. | Original component comparison. |
| SHELL-WATCH-005 | A whitespace-only reason uses the pattern fallback title. | Original component comparison. |
| SHELL-WATCH-006 | Titles longer than 500 characters retain the first 500 and append three periods. | Original component comparison. |
| SHELL-WATCH-007 | The default limit is 100 occurrences. The last batch flushes and a limit notice directs the reader to the output file. | Original component comparison and Pi JSON. |
| SHELL-WATCH-008 | RE2 inline flags work. | Original component comparison. |
| SHELL-WATCH-009 | The monitor constructor rejects RE2-unsupported lookahead. | Original component comparison. The factory-level failure policy is a separate contract. |
| SHELL-WATCH-010 | The monitor constructor rejects patterns longer than 500 characters. | Original component comparison. The factory-level failure policy is a separate contract. |
| SHELL-WATCH-011 | Matched text longer than 5,000 characters is omitted with its length stated. | Original component comparison. |
| SHELL-WATCH-012 | The batching timer starts at the second occurrence, not at the first notification. | Original component comparison with controlled timers. |
| SHELL-WATCH-013 | A single deferred match reports its occurrence number and latest match. | Original component comparison. |
| SHELL-WATCH-014 | The debounce is at least 5,000 milliseconds. | Original component comparison with controlled timers. |
| SHELL-WATCH-015 | Processing slices of 65,536 characters preserve matches across the internal slice boundary through carryover. | Original component comparison. |
| SHELL-WATCH-016 | Zero-width matches terminate and follow the original end-offset rule. | Original component comparison. |
| SHELL-WATCH-017 | Finish flushes once. Duplicate finish and later output do not emit more notices. | Original component comparison. |
| SHELL-WATCH-018 | A monitor that never matches sends no progress notices. | Original component comparison. |
| SHELL-WATCH-019 | An empty watch pattern creates no monitor and does not stop the command. | Original factory execution and Pi JSON. |
| SHELL-WATCH-020 | A whitespace-only watch pattern creates no monitor and does not stop the command. | Original factory execution and Pi JSON. |
| SHELL-WATCH-021 | A malformed watch pattern logs a warning and does not stop the command. | Original factory execution and Pi JSON. |
| SHELL-WATCH-022 | An oversized watch pattern logs a warning and does not stop the command. | Original factory execution and Pi JSON. |
| SHELL-STREAM-001 | stdout and stderr each retain their own UTF-8 decoder state. Split multibyte characters reach monitoring and the output file intact. | Source inspection at the local-exec decoder setup and a gated native subprocess test. No live Cursor stream comparison. |
| INSTALL-002 | A missing regex dependency leaves unrelated tools loadable but refuses a valid watched command before it runs. | Pi local-install regression tests. This preserves existing Pi installation behavior and is not an observed Cursor dependency-outage contract. |

The observer retains 1,024 characters of carryover. It does not promise arbitrary cross-chunk regex history. Its matching uses RE2JS in multiline mode. `AwaitShell.pattern` still uses JavaScript regex syntax. The monitor change does not redefine that separate input.

## Additional shell requirements

| Behavior ID | Requirement or open question | Evidence and current disposition |
| --- | --- | --- |
| SHELL-LIFECYCLE-001 | Immediate launch names a shell, process, and output file. | Source inspected. Existing Pi entry-point tests rerun as regression checks, not fresh live-Cursor equivalence proof. |
| SHELL-LIFECYCLE-002 | A foreground wait can complete or hand execution to the background. | Source inspected. Existing Pi entry-point tests rerun. Cancellation and handoff races need broader differential coverage. |
| SHELL-LIFECYCLE-003 | Completion, failure, abort, and observed completion have different notice policies. | The captured agent-exec and local-exec factories contain the policies. Exhaustive runtime reconstruction remains open. |
| SHELL-LIFECYCLE-004 | Output file headers refresh and final footers describe exit. | Source inspected. Native header and process tests rerun. Full platform comparison remains open. |
| SHELL-LIFECYCLE-005 | Owner-session changes must not deliver old work to an unrelated conversation. | Original records carry conversation IDs. Native behavior across session switches has not been verified. |
| SHELL-LIFECYCLE-006 | User cancellation must not leave an uninterruptible final-settle wait. | The installed-Pi lifecycle probe observes a signal at `agent_end` but no signal at `agent_before_settle`. Source inspection shows the signal belongs to the already-ended low-level run. A cancellation hang is still an inference, not a completed reproduction or fix. |
| SHELL-LIFECYCLE-007 | Session shutdown stops owned processes without stale notifications. | Native process and Pi RPC regressions cover ordinary shutdown. Parent crash, descendant process groups, signal escalation, and platform differences require more work. |
| SHELL-PERMISSIONS-001 | Sandbox policy, invariant blocks, approval, and unsupported-platform outcomes preserve the reference policy. | Source inspected in local-exec shell-stream execution. Full Pi-native parity is not established. |
| SHELL-STREAM-002 | Output limits, truncation markers, backpressure, and monitor visibility after trimming retain the full executor contract. | The source has per-stream limits and trimming branches outside the observer. The observer comparison does not cover them. Native equivalence remains open. |
| SHELL-WATCH-CONFIG-001 | Non-default internal notification limits and alternate debounce configuration retain reference semantics. | The reference observer accepts additional configuration beyond the current public tool shape. Reachability and equivalent native configuration remain unresolved. |

## Unresolved plugin and dependency requirements

These stable IDs keep unfinished requirements visible. They do not assert a complete behavior count.

| Behavior ID | Required coverage | Authoritative starting point | Status |
| --- | --- | --- | --- |
| RESOURCE-001 | Plugin identity, skill discovery, frontmatter, invocation, and resource precedence. | `pstack/.cursor-plugin/plugin.json`, skill frontmatter, and Cursor resource factories. | Original runtime matrix incomplete. |
| RESOURCE-002 | Both pstack agent definitions and team-kit agent definitions. | `pstack/agents/` and `cursor-team-kit/agents/`. | Contracts and native end-to-end comparison incomplete. |
| RESOURCE-003 | Team-kit always-applied rules and their loading conditions. | `cursor-team-kit/rules/`. | Source captured. Runtime precedence and persistence incomplete. |
| WORKFLOW-001 | Every pstack playbook, conditional route, safety pause, retry, and failure path. | `pstack/skills/poteto-mode/SKILL.md` and `playbooks/`. | Semantic reconstruction incomplete. |
| WORKFLOW-002 | Team-kit control, review, compiler, PR, smoke-test, and synthesis workflows. | `cursor-team-kit/skills/`. | Source captured. Dependency traversal and workflow execution incomplete. |
| MODE-001 | One-turn skill attachment, persistent custom mode, startup selection, turn context, and exit. | Reference README custom-mode instructions and Cursor custom-mode implementation. | Native command drives are regression evidence only. Full original matrix incomplete. |
| PLAN-001 | Plan mode permissions, plan files, todos, mode exit, and local or remote build dispatch. | Relevant pstack playbooks and host implementation. | Reference host contracts incomplete. |
| MODEL-001 | Model discovery, role overrides, reasoning budgets, fast variants, rejection, and fallback. | `pstack/skills/setup-pstack/` and routed skill instructions. | Source captured. Account-dependent model behavior unverified. |
| TASK-001 | Local task launch, background delivery, resume, fork, stop, attachments, depth, readonly, and persistence. | Agent definitions, pstack skill instructions, and captured subagent factories. | Partial source inspection. No complete original workflow matrix. |
| TASK-002 | Cross-process concurrency, one-writer ownership, crash recovery, and notification deduplication. | Captured agent-exec and local-exec task lifecycle. | Unverified against the original. |
| CLOUD-001 | A cloud task receives its own VM and branch, can install dependencies, run an app, and record results without changing the operator's machine. | `pstack/docs/guide/02-poteto-mode.md` and the multi-phase and orchestrate playbooks. | Known material gap. Current Pi environment `cloud` creates a local worktree and process, not a remote VM. |
| LOOP-001 | Local timed runs, explicit stop, pending-work waits, event-gated wakes, and restart behavior. | Installed Cursor loop skill and pstack overnight instructions. | Local and hosted variants are distinct. Complete contract and runtime matrix missing. |
| HOSTED-001 | Hosted timer and PR triggers continue when the operator's desktop session is closed. | Installed Cursor loop skill and `pstack/docs/guide/07-overnight.md`. | Hosted reference runtime not exercised. Local supervision is not assumed equivalent. |
| WEBHOOK-001 | Hosted routine creation, URL and sender-key handoff, authenticated POST, event envelope, and wake behavior. | `pstack/skills/make-bot-ui/SKILL.md`. | Known location difference. Native loopback routines do not establish hosted reachability or hosted lifecycle parity. |
| WEBHOOK-002 | Secret handling, browser separation, retry log, and Tailscale reachability. | `pstack/skills/make-bot-ui/SKILL.md`. | No live integration test. Tailscale was not found on this host. |
| BENNY-001 | Two dormant automations activate only through setup and preserve Slack report-thread coordinates. | `pstack/automations/benny/FOR_AGENTS.md`. | No configured Slack integration or hosted trigger evidence. |
| BENNY-002 | Triage markers, duplicate handling, permissions, issue creation, reproduction, and draft fixes. | `pstack/automations/benny/skills/` and templates. | Reference workflow execution and provider contracts incomplete. |
| FORGE-001 | GitHub default, Origin discovery, CI checks, PR comments, merge safety, and failure paths. | pstack shipping, babysit, and opening-a-PR playbooks and team-kit forge skills. | No external writes or live PR workflow performed. Origin was not found on this host. |
| REVIEW-001 | Bugbot and agentic security findings receive skeptical, evidence-backed triage rather than automatic edits. | `pstack/skills/poteto-mode/references/bugbot-triage.md`. | Hosted review behavior not exercised. |
| SCRIPT-001 | Script bootstrap, commander parsing, plan checking, PR watching, cleanup, and decision logging preserve behavior. | `pstack/skills/poteto-mode/scripts/` and its pinned lockfile. | Source and dependency identities captured. Full branch comparison pending. |
| SCRIPT-002 | Statechart tooling, fast-check behavior, TLA+ execution, model checking, and rendering. | `pstack/skills/statechart/`. | Source captured. Transitive executable closure and runtime comparison pending. |
| CONTROL-001 | CLI and UI control workflows drive real programs, preserve artifacts, and clean up owned processes. | Team-kit `control-cli` and `control-ui`. | Pi CLI changes are tested. Broader Cursor IDE and browser workflow comparison missing. |
| HOST-001 | Cursor built-in create-skill, autopilot, Canvas, browser, image, question, and subscription capabilities are included when a reachable workflow uses them. | Reference README and direct skill references. | Host dependency traversal remains open. The candidate cursor-sdk archive is not proof of a dependency relationship. |
| INSTALL-001 | Installation, resource packaging, update, startup, permission, and restart behavior match the selected host contract. | Reference manifests and actual Cursor and Pi package loaders. | Native package checks are not full cross-host equivalence proof. |

## Completion rule

`VERIFIED` requires a closed dependency graph and complete behavioral inventory, followed by passing native behavior for every requirement. A missing original host, inaccessible hosted capability, unknown contract, or local substitute leaves a material gap. This run remains `NOT VERIFIED` even if all repository tests pass.
