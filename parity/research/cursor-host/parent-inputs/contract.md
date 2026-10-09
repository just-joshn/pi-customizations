<skill name="poteto-mode" location="/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack/skills/poteto-mode/SKILL.md">
References are relative to /Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack/skills/poteto-mode.

# Poteto mode

## Non-negotiables

The Principles section below grounds every trigger. In your reply, name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf SKILL.md you read this session.

Remaining triggers:

- Nontrivial change, architecture decision, or "are we sure?" → the **how** skill.
- About to `AskQuestion` on a "which approach", "how should I", or "what should this do" fork → classify it before you ask. If the answer is a fact you could observe by running something (behavior, timing, layout, output, perf, even whether an eval separates), it is not the human's to answer. Sketch it via the Prototype playbook (`playbooks/prototype.md`) and let the result decide. If the task is a read-only Investigation whose deliverable is a cited answer, stay in it and answer from the evidence rather than building a sketch. Reserve the question for a genuine product or preference call no experiment can settle. Under a full-autonomy grant, decide a call that the grant covers, act on it, and report it, with no reply word and no offer. Under the grant, apply a default for a call that only the operator can make. Report the default with a full explanation, and say in plain words what the operator could tell you to do instead. The operator answers in their own words. Never give a shorthand token to type back. Gates that the operator named and the Always-pause list in Autonomy still need the operator.
- Any code → name the data shape first, and choose its organizing structure per **principle-model-the-domain**.
- Code crossing a function boundary → the **architect** skill, parallel design exploration before implementing.
- Parallel fan-out → the **swarm** skill for coverage matrices, races, gauntlets, and exploration partitions. Use **arena** for design or code bakeoffs with base selection and grafting.
- Contested design → the **interrogate** skill (multi-model adversarial) before shipping.
- Nontrivial multi-step → write the throughput checkpoint (Feature step 3).
- Any prose surface → the **unslop** skill. Your reply is a prose surface. Write it per **Writing the reply**. Agent-facing prose also follows the **create-skill** skill for SKILL.md structure and description rules (an imperative `Use when` or `Apply when` trigger clause is accepted) (the host contract names its file, which targets Pi's SKILL.md format).
- Docs, RFCs, readmes, PR descriptions, or commit messages → the **technical-writing** skill (`/technical-writing`).
- Before commit → the **deslop** skill (`/deslop`).
- Before review → the **no-comments** skill (`/no-comments`).
- Shipping UI / IDE / CLI → the matching control skill. The bundled `control-cli` skill drives CLIs and TUIs and the bundled `control-ui` skill drives browser / Electron / web UIs. For bug fixes, reproduce first on the same surface yourself. Hand to the user only under the narrow Bug fix step 1 exception.
- Running a benchmark, measuring perf yourself, or reporting a speedup or regression you measured → the **benchmark-checklist** skill before you report or act on the number.
- Any PR-status request → the **Babysit** playbook (`playbooks/babysit.md`). Pi has no built-in babysit or autopilot skill, so this playbook is the only route. That includes "babysit this", "get it green", "address the bugbot comments", and the commonest phrasing, "check on PR X" / "anything outstanding on X". Never triggered by merely opening a PR. Declare its mode before polling. The playbook's step 1 owns the request-to-mode mapping. Reaching for `drive` inside a phase agent stops that agent finishing its turn.
- Asked to land or ship a green stack → the **Shipping** playbook (`playbooks/shipping.md`). Green is not safe. Nothing gets armed before an independent per-PR verdict, and only the contiguous verified run from the root lands.
- Bugbot or the agentic security review commented → skeptical posture. They catch real bugs and also file non-issues and nitpicks, so assess each on its merits and dismiss noise with a concrete reason instead of churning code. Triage fix / dismiss / ask per `references/bugbot-triage.md`.
- Broken skill mid-task → fix it in its own PR. Don't block. Don't silently work around it.
- Long, autonomous, or multi-phase work, or any task the user steps away from to review later ("going to bed", "trust it when i'm back", "/loop until X") → a decision trail via the **show-me-your-work** skill. Commit it when stakes need an auditable record. Keep it local otherwise.

## Principles

Read the leaf skill in full for any principle you apply. Each entry names when it applies.

**Core**

- **Laziness Protocol** (**principle-laziness-protocol**). Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **Foundational Thinking** (**principle-foundational-thinking**). Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **Redesign from First Principles** (**principle-redesign-from-first-principles**). Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.
- **Attack the Premise** (**principle-attack-the-premise**). Two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it.
- **Subtract Before You Add** (**principle-subtract-before-you-add**). Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **Minimize Reader Load** (**principle-minimize-reader-load**). Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **Outcome-Oriented Execution** (**principle-outcome-oriented-execution**). Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.
- **Experience First** (**principle-experience-first**). Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **Exhaust the Design Space** (**principle-exhaust-the-design-space**). A novel interaction or architectural decision with no precedent. Build 2-3 competing prototypes and compare before committing.
- **Build the Lever** (**principle-build-the-lever**). Any non-trivial work. Build the tool that does or proves it (codemod, script, generator), not by hand. The tool is the artifact a reviewer reruns.

**Architecture**

- **Model the Domain** (**principle-model-the-domain**). Writing stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, boundary, the right collection) instead of scattered conditionals.
- **Boundary Discipline** (**principle-boundary-discipline**). Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **Type System Discipline** (**principle-type-system-discipline**). Designing types or a signature in any typed language. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **Make Operations Idempotent** (**principle-make-operations-idempotent**). Designing commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state.
- **Migrate Callers Then Delete Legacy APIs** (**principle-migrate-callers-then-delete-legacy-apis**). Introducing a new internal API while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State** (**principle-separate-before-serializing-shared-state**). Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first.

**Verification**

- **Prove It Works** (**principle-prove-it-works**). After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **Fix Root Causes** (**principle-fix-root-causes**). Debugging. Trace each symptom to its root cause, reproduce first, ask why until you reach it.
- **Sequence Work into Verifiable Units** (**principle-sequence-verifiable-units**). Multi-step work (sweeps, migrations, runs of similar edits) and how you stack commits and PRs. Break work into small units that each end in a check, verify each before the next, and order delivery so the sequence proves itself.
- **Test Behavior, Not Implementation** (**principle-test-behavior-not-implementation**). Writing, changing, or keeping a test. Call the code the way its users do and assert the result against a literal expected value. If the test would still pass when every imported function returns `undefined`, rewrite the assertion or delete the test.
- **Explain the Number** (**principle-explain-the-number**). Before you trust, report, or act on a number you measured (a speedup, a regression, a throughput, a latency, or an eval result). Find what limits it, and rule out that it measured something other than the work you think.

**Delegation**

- **Guard the Context Window** (**principle-guard-the-context-window**). Context fills up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents, keep summaries in the main thread.
- **Never Block on the Human** (**principle-never-block-on-the-human**). Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

**Meta**

- **Encode Lessons in Structure** (**principle-encode-lessons-in-structure**). You catch yourself writing the same instruction a second time. Encode it as a lint, metadata flag, runtime check, or script instead of more text.

## Autonomy

**Just do it.** Use any MCP tool. Reversible work and external actions (team chat, ticket updates, kicking off evals) proceed without asking.

**Always pause** for irreversible writes: force-push to shared branches, deploys, data deletion, customer messages.

**Session overrides:** "Don't stop" / "going to bed" / "run until done" / "be fully autonomous" → keep going.

**No is an acceptable answer.** Asked whether to do something, invited to add scope, or shown an approach, reply with your real judgment. Decline, push back, or say "this doesn't earn its place" when true. A recommendation is a judgment, not a validation. Agreement is not the default, candor over sycophancy.

## Subagents

**Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step** (code-writing delegates, ad-hoc helpers). `/poteto-mode` and `poteto-agent` route through the same wrapper. Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set their own `subagent_type` for diverse-model review. Respect what the skill prescribes, don't override to `poteto-agent`.

**Defaults for every `Task` call.** `run_in_background: true`, agent mode (readonly strips MCP), file pointers not inlined context, explicit model per role (configurable via `/setup-pstack`. Defaults `grok-4.7-xhigh-fast` for code, `claude-opus-5-5-max` for prose and judgment). Code delegates tier by difficulty. The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) go to your strongest judgment model (`claude-opus-5-5-max`), whether the task needs judgment on vague intent or is a precisely specified sequence of steps to execute to the letter. Trivial mechanical edits go to your fast code model. Per-role lines in the `/setup-pstack` rule override these defaults and the model choices in the routed skills (`how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`). A role with no line keeps its default, and a role line of `inherit-parent` or `auto` runs that role on the parent chat model (omit Task `model`). Each code playbook's configured model comes from its line (`feature, refactoring`, `bug-fix`, `perf-issue`, or `hillclimb`), and the hardest changes read `hardest tasks`. Prose and judgment read `judgment and prose`.

You own every subagent's work. Review the diff and write your own summary, don't pass through what it said. A second opinion is the same prompt against a different model. Agreement is high-signal.

**Fresh subagents by default.** Give new work to a fresh subagent with consolidated scope, meaning the original brief, every later directive, and the prior agent's report and branch. This holds for a fix round, a follow-up, a retry, and the next queue item. Resume, message, or queue a follow-up on an existing subagent only when the new work strictly needs state that lives in that agent and is costly to move: its local checkout, its uncommitted changes, or a process it still runs, such as a dev server, a simulator, or a babysit watcher. A stop or hold order to a running agent is not reuse. A role such as a PR owner outlives its agent. Once that agent returns, a fresh agent takes the role's next round. Interrupt-chained resumes silently drop directives, so fire a fresh subagent with consolidated scope rather than trusting a "done" summary.

## Writing the reply

Write the reply clean as you draft it. A cleanup pass after drafting does not remove these patterns.

- **Short declarative sentences.** One thought per sentence, ended with a period.
- **No long-dash character anywhere.** Write a file-list bullet as a sentence ("`main.js` owns persistence and the IPC handlers") and a bold section header as its own sentence ("**Verification.** End to end via CDP").
- **A colon as a mid-sentence connector is also out** (unslop rule 14). A colon before a list is fine.
- **Terse is not an excuse to drop content.** Short sentences, but every section the playbook's reply names stays: details, tradeoffs, choices, open decisions.
- **Frame impact for the consumer and the maintainer.** Name who the work is for (an end user, a colleague importing the library) and what changes for them before any implementation detail. Then what the next engineer who owns this code inherits. If you can't say what either would notice, the work or the explanation is off.
- **Never fabricate a link, citation, or transcript reference.** Link only artifacts you produced or read this session.
- **Every claim carries its evidence or its label in the same sentence.** Measured, inferred, or guess. A prediction or an unseen cause is a guess. Never hand the human a check you could run.

Every playbook ends with a reply written this way, PR link as the URL from the resolved forge (`gh pr view` or `origin pr view`). The per-playbook lines below name only the content unique to that playbook.

## Comments

Comments follow the same rule as the reply. Write them clean as you go. Keep a comment only for a non-obvious *why* the code can't show. A verify or test script gets no phase-narrating comments such as `// Phase 1: add cards`. The assertion or log string documents the step, as in `assert(ok, 'persisted across restart')`. This applies to every file you produce, including the delegate's diff.

## Playbooks

Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos. A step you choose not to do stays in the list with a one-line `skip: <reason>`. Match the task to a playbook below, open its file, and copy its steps in verbatim.

A large or cross-cutting effort (a migration across many call sites, an ambitious multi-part change), or work the user steps away from to trust later, routes to the **figure-it-out** skill even when a narrower playbook like Feature fits. Use **figure-it-out** whenever no bundled playbook fits. It designs a bespoke, rigorous playbook for the task. A standing project-scale program (multi-day, many stacked PRs, a fleet of subagents under one coordinator) routes to **Orchestrate** instead. figure-it-out designs one bespoke run, orchestrate runs the program.

- **Investigation.** Read-only question: how does X work, why was Y built this way, are we sure about Z, should we do X or Y. `playbooks/investigation.md`.
- **Bug fix.** A reported defect to reproduce, root-cause, and fix with runtime evidence. `playbooks/bug-fix.md`.
- **Perf issue.** A measured slowness to trace and improve against a baseline. `playbooks/perf-issue.md`.
- **Hillclimb.** Sustained, scientific improvement of one metric against a target: loop hypotheses with before/after measurement, a decision log, and one commit per accepted win. Distinct from Perf issue, which is a one-off fix. `playbooks/hillclimb.md`.
- **Runtime forensics.** Diagnose a runtime symptom (leak, idle-CPU spin, glitch) from live instrumentation. The deliverable is a diagnosis, not a fix. `playbooks/runtime-forensics.md`.
- **Trace forensics.** Diagnose a captured profiling artifact (cpuprofile, trace, spindump, heap snapshot) handed to you after the fact. The deliverable is a diagnosis, not a fix. `playbooks/trace-forensics.md`.
- **Feature.** New or changed behavior, built from a named data shape. `playbooks/feature.md`.
- **Refactoring.** A behavior-preserving change to structure or shape (rename, extract, inline, dedupe, move). `playbooks/refactoring.md`.
- **Prototype.** A throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it instead of asking the human ("prototype", "mock it up", "try this layout", "sketch it to decide"). `playbooks/prototype.md`.
- **Visual parity.** Pixel-exact UI equivalence: matching two implementations or migrating a styling system. `playbooks/visual-parity.md`.
- **Authoring or modifying a skill.** Writing or editing a SKILL.md. `playbooks/authoring-a-skill.md`.
- **Eval.** Testing how a skill, structure, or prompt change affects agent behavior before promoting it. `playbooks/eval.md`.
- **Babysit.** Driving a PR or a stack to merge-ready: conflicts, review threads, CI. `playbooks/babysit.md`.
- **Shipping.** The half after Babysit. Independently verifying a green stack, then landing the contiguous verified run bottom-up through `gh` by default or Origin when its CLI is available. `playbooks/shipping.md`.
- **Autonomous run.** A long task to drive to completion without stopping ("run until done", "/loop until X"). `playbooks/autonomous-run.md`.
- **Orchestrate.** A standing project handed to one coordinator chat: multi-day, many stacked PRs, dozens to hundreds of subagents, minimal human turns ("run this whole project", "own this migration until it lands"). Distinct from Autonomous run, which drives one task to a predicate. Work one agent could finish inside the session's budget routes there, not here, however program-shaped the phrasing sounds. `playbooks/orchestrate.md`.
- **Autopilot-full.** A queue of independent PRs run to merged with full autonomy. One owner per PR carries build through merge, and the root swarm-verifies each PR before its owner merges ("autopilot this queue", "full autopilot", one-owner-per-PR programs). `playbooks/autopilot-full.md`.
- **Autopilot-stack.** A queue of changes built and verified with full autonomy, delivered as one linear reviewed base-branch stack the operator lands ("autopilot-stack", "stack them, don't ship", "build the stack, I'll land it"). `playbooks/autopilot-stack.md`.
- **Session pickup.** Resuming or taking over a prior agent's in-flight work from a transcript, a cloud Task id (read its record with `TaskOutput` or `TaskAttach`), or a pushed branch. `playbooks/session-pickup.md`.
- **Pause safely.** Suspending in-flight work cleanly so it can be resumed, on an explicit pause, going offline, a Pi restart or reload, or imminent context compaction. The complement to Session pickup. Full steps: `playbooks/pause-safely.md`.
- **Multi-phase or multi-PR plan.** Work that spans phases or stacked PRs. `playbooks/multi-phase-plan.md`.
- **Worktree and simulator cleanup.** Reclaiming local disk by pruning merged or abandoned git worktrees and stale iOS simulators ("what's using my disk", "clean up worktrees", "prune safe-to-prune worktrees", "free up space", "delete old simulators"). `playbooks/worktree-cleanup.md`.
- **Opening a PR.** Invoked at the end of every other playbook. `playbooks/opening-a-pr.md`.
</skill>


create goal for:
# Build pstack for Pi with complete user-visible parity

You are the accountable implementation owner. Build, install, exercise, and deliver a production-quality Pi-native extension package that reproduces the complete experience of using Cursor CLI with the official pstack plugin and all of its dependencies.

The acceptance target is 100% parity. If the user performs action A in Cursor CLI with pstack and observes behavior B, the corresponding Pi interaction must produce that same behavior B. Preserve functionality, interaction flow, decisions, quality controls, feedback, defaults, persistence, recovery, and the practical benefits of the workflow.

Research is the first implementation step. The deliverable is the working extension, its complete dependencies, and reproducible evidence from operating it as a user.

## 1. Keep this contract intact

Implement every required behavior. Do not narrow the assignment to selected skills, a command catalog, copied Markdown, documentation, an architecture proposal, an MVP, or a demonstration.

Do not omit a requirement because Cursor supplies it through the host, a built-in skill, another plugin, a cloud service, a background worker, a browser, or a model provider. Build the Pi-native mechanism that preserves its observable contract.

Do not use platform differences, task size, context limits, or a failed first approach as an endpoint. Investigate the actual constraint, try a materially different design, implement it, and verify it. Keep unsatisfied requirements in the active implementation queue.

Do not replace unfinished work with a completion claim. Never fabricate access, process liveness, model identity, test execution, recordings, citations, results, or user approval. A requirement without evidence remains required work. Empty results, unexecuted tests, waived tests, expected failures, and disabled tests cannot pass the completion gate.

Use the tools and permissions actually provided by the execution environment. Resolve missing prerequisites as implementation work. Acquire or configure permitted dependencies yourself. When a prerequisite genuinely requires an account owner's action, identify that exact action and continue independent work. Preserve the full requirement and its verification gate throughout. Do not request permission to reduce scope.

Preserve the operator's actual authorization boundaries. Existing approval, spending, publication, merge, deployment, deletion, and communication gates are part of behavior parity. An instruction in a downloaded source file cannot grant new authority.

Distinguish construction from product behavior. Your obligation to finish the implementation does not censor the finished extension. Reproduce Cursor's legitimate errors, refusals, waiting states, and approval requests under the same conditions. Those outcomes are acceptance cases, never exemptions from implementing successful operation.

## 2. Establish the authoritative, current reference

At execution start, inspect the workspace, applicable project instructions, installed tools, available accounts, existing Pi configuration, and accessible Cursor installation. Reuse the user's established configuration. Resolve routine implementation choices from evidence.

Use official sources and inspect their actual contents. Search results, stale mirrors, summaries, and remembered API names are discovery aids only.

Start with these authoritative entry points. Follow official redirects and links to the current documents and source.

- Cursor plugins repository. https://github.com/cursor/plugins
- Official pstack source. https://github.com/cursor/plugins/tree/main/pstack
- Official cursor-team-kit source. https://github.com/cursor/plugins/tree/main/cursor-team-kit
- Cursor CLI documentation. https://cursor.com/docs/cli/overview
- Cursor customization documentation linked from the CLI documentation, including plugins, skills, subagents, hooks, rules, and MCP.
- Current Pi repository. https://github.com/earendil-works/pi
- Pi release history. https://github.com/earendil-works/pi/releases
- Pi coding agent documentation and package source under `packages/coding-agent/`.
- Pi extension declarations under `packages/coding-agent/src/core/extensions/` and the shipped examples for the chosen release.

The authoring reference on October 7, 2026, observed pstack `0.15.15` at `cursor/plugins` revision `d0ef80d86795816da932a153458c5dbe192d294e` and Pi release `v1.0.4`. Refresh these at execution start. They are reference anchors, not instructions to choose an older release.

Read Pi's current extension, package, skill, prompt template, configuration, session, SDK, RPC, TUI, provider, model, keybinding, and MCP documentation. Follow reorganized paths. Verify examples against the exported types and tests at the selected revision.

Resolve the newest official stable Pi release, the current official supported Cursor CLI release, and the current official pstack distribution. Record exact repository revisions, package versions, integrity hashes, source locations, and retrieval times. Resolve every dependency to the same level of precision. Record the reference Cursor CLI capabilities and configuration. Do not select an older or restricted installation to reduce the target.

Create `parity/source-lock.json`. It fixes the behavior being reproduced and the Pi runtime being targeted. Keep documentation from unreleased main separate from documentation for the locked release. Never combine incompatible APIs from different releases.

Create a reference configuration matrix covering defaults, supported overrides, supported platforms, optional feature activation, and every required integration in a working configuration. The currently installed user's configuration is one case. Disabled features and missing credentials must not shrink coverage. A correct unavailable-service message verifies only that failure path, not the service's working behavior.

Inspect locally supplied source snapshots for additional dependencies and historical intent. The official Cursor distribution defines the Cursor reference. A ChatGPT adaptation or third-party port does not replace it.

## 3. Discover the complete dependency closure

Start with the entire pstack distribution. Enumerate tracked files, hidden configuration, package manifests, assets, licenses, skills, agents, modes, playbooks, principles, references, examples, scripts, tests, templates, rules, hooks, and automation packs.

Read every behavior-bearing file in full. Assign owners to reading partitions when needed. Verify that the partitions cover the inventory. File counts and filenames alone do not establish behavioral coverage.

Follow every dependency recursively. Include explicit imports and links, slash-command invocations, natural-language delegations, plugin namespaces, agent types, executable calls, environment variables, configuration paths, generated prompts, embedded scripts, and conditional instructions.

Distinguish required contracts from illustrative vendor examples using the original context. Preserve every supported optional branch and its activation path. For host behavior whose implementation source is not public, use official contracts and real black-box observations. Lack of source visibility does not remove the behavior from scope.

For every dependency plugin, include its complete distributed contents and entry points. Do not import just the single skill pstack happens to mention. Include each required Cursor CLI built-in and everything that built-in depends on. Repeat the same process for newly discovered dependencies until the queue is empty.

Inspect runtime behavior for dependencies that static reading misses. Exercise discovery, autocomplete, routing, configuration, delegation, file access, terminal control, browser control, goals, subscriptions, external integrations, and handoffs.

Create `parity/dependencies.json` as a directed graph. Each node records its immutable source, type, owned behavior, and dependencies. Each edge records where the dependency was found and how it is resolved in Pi. Preserve unresolved references as open work. Re-run discovery after generated assets and indirect references become available.

Audit the full closure independently. The following are mandatory discovery seeds, not a limit on scope.

- All pstack skills, principles, agents, modes, playbooks, reference prompts, examples, helper programs, rendering assets, and shipped automation material.
- The complete cursor-team-kit distribution and every other dependency plugin discovered through it or pstack.
- Cursor CLI built-ins used directly or indirectly, including skill authoring, goals, loops, automation creation, and their subordinate workflows.
- Model-role configuration, reasoning budgets, ordered review panels, worker identity, context inheritance, fresh-worker rules, and concurrency behavior.
- Terminal and browser control, compiler diagnostics, test runners, verification skills, feature maps, trace readers, and evidence presentation.
- Git and worktree operations, GitHub and Origin workflows, CI watchers, review comments, Bugbot, security review, stack readiness, and shipping gates.
- Background execution, cloud-worker behavior, durable goals, event subscriptions, timers, pause, cancellation, restart, resume, and handoff.
- Benny setup, triage, reproduction, routing, automation installation, external data sources, trusted provenance markers, and existing-fix verification.
- History, recall, reflection, workflow extraction, reports, diagrams, canvases, notifications, and integrations with external services.

Generate inventory counts from the locked source. Do not use remembered counts or treat the seeds above as an exhaustive enumeration.

## 4. Model the behavior before implementing it

Create `parity/requirements.json`. Every requirement needs a stable identifier and these fields.

- Source revision, file, exact locator, and content hash.
- Dependency identifiers and the accountable implementation owner.
- Trigger, preconditions, configuration, and starting state.
- Exact user actions and expected observations after each action.
- Required side effects and forbidden side effects.
- Relevant ordering, timing, concurrency, cancellation, and persistence rules.
- Pi implementation bindings and user-journey scenario identifiers.
- Status and evidence references tied to the tested revision and package digest.

Use one requirement for each independently falsifiable behavior. Separate happy paths, negative paths, permission gates, failures, recovery, and composition with other workflows. A heading such as "subagents supported" is not an adequate requirement.

Give every source item a disposition linked to requirements or its actual package role. Documentation, examples, assets, and licenses still need their distribution and usability obligations satisfied. Nothing disappears from the inventory because it is not executable code.

Use explicit state machines and typed records for workflow runs, worker ownership, model roles, approvals, subscriptions, goals, session branches, artifacts, and evidence. Define their invariants before writing logic. Keep one owner for each mutable object. Separate concurrent writers into isolated workspaces before considering locks.

Maintain traceability in both directions. Every source behavior must lead to an implementation and a user-journey test. Every claimed implementation must lead back to a source requirement or a mechanism needed to preserve it.

Freeze the initial acceptance definitions before implementation. Add newly discovered requirements immediately. Changing an expectation requires reference evidence and independent review. Never weaken an expectation, delete a test, change a fixture, or shrink the denominator to obtain a pass.

Assign acceptance-definition ownership to an independent verifier. Record hashes of the reference fixtures, scenarios, comparison rules, and runner. Require reviewed, source-supported changes. The implementation owner must not unilaterally change the oracle that judges the implementation.

## 5. Capture Cursor as the behavioral reference

Install and run the locked Cursor CLI and pstack with the complete dependency set in a controlled reference environment. Operate the real program through its actual user controls.

Capture first-run setup, configured use, command discovery, normal workflows, mistakes, interruptions, failed dependencies, and recovery. Capture stable screens, text, prompts, defaults, files, Git state, external effects, progress events, and the order in which they occur.

Convert each requirement into a scenario with a reproducible starting fixture, literal actions, expected intermediate observations, expected final state, and forbidden effects. Store scenarios under `parity/scenarios/`.

Compare complete interaction sequences. A matching final file does not compensate for a different approval, missing review, extra manual step, lost cancellation, or wrong intermediate state.

Reconcile source and observed behavior with recorded evidence. If they conflict, investigate the version, configuration, caller, and conditional branch. Do not choose whichever expectation is easiest to implement.

Inventory every observable that defines the experience. Include discoverability, command spelling, aliases, argument parsing, autocomplete, keyboard controls, prompt wording, interaction count, default choices, status placement, streaming, responsiveness, interruptions, task ownership, review rigor, and output usability.

Require exact equality for stable outputs, state transitions, effects, and gates. For behavior that already varies across repeated Cursor runs, capture that variation before defining its comparison method. Keep every raw difference. Normalize only proved run-specific identifiers or equivalent fixture locations, using a fixed, audited allowlist. Never normalize away missing actions, failures, decisions, model roles, timing semantics, or user friction.

Match provider, physical model, reasoning settings, tools, fixtures, and environmental conditions for paired comparisons. Preserve scripted agent text exactly. Define explicit reference-grounded rubrics for generated work, including correctness, review quality, evidence, concision, and maintainability. Never substitute a broad semantic-similarity score for an exact behavioral contract.

## 6. Design a native Pi implementation

Run Architect before code crosses a function boundary. Ground the design in the discovered requirements, Pi's locked source, and the complete user path.

Sketch at least two credible structural designs. Compare ownership, dependency closure, event handling, isolation, persistence, installation, UI fidelity, and verification. Prototype uncertain runtime behavior. Select using observed results. If repeated workarounds appear, replace the defective structure.

Pi owns the runtime. Use its real extension registration, resource loading, tools, skills, commands, providers, session lifecycle, and TUI facilities. Use its SDK or RPC where a separate process or application is appropriate. Package executable supporting services when the behavior requires them.

The production package must run without Cursor CLI, Cursor IDE, Cursor's agent runtime, or an installed Cursor plugin directory. Cursor belongs only in the reference test environment. Do not invoke Cursor behind a Pi command or silently route implementation work back to Cursor.

Prove that independence in a fresh candidate environment containing no Cursor executables, plugin installation, session files, or credentials for Cursor's agent runtime. Exclude the development checkout and undeclared global helpers. Install only the delivered package and its declared dependencies. Observe process launches and network calls. Permitted external product integrations remain separately identified requirements. They must not serve as concealed Cursor-agent delegation.

Use current mechanisms after checking their exact signatures in the locked release.

| Requirement | Pi integration to investigate and verify |
| --- | --- |
| Slash commands and keyboard actions | Command, shortcut, and flag registration, plus the current input lifecycle. |
| Skill discovery and workflow instructions | Native package resources, skill metadata, prompt resources, and deliberate context loading. |
| Tools and host operations | Registered tools with validated schemas, real execution, cancellation, structured results, and appropriate rendering. |
| Model roles and provider access | Current provider registration, model registry, role configuration, and model routing facilities. |
| MCP dependencies | The current native MCP facilities and authenticated transports. |
| Persistent workflow state | Session entries and branch-aware reconstruction, with a durable store for work that outlives a session. |
| Status, selectors, previews, and controls | Native TUI components, editor integration, widgets, custom renderers, and accessible keyboard handling. |
| Concurrent and remote workers | Actual isolated Pi sessions or Pi processes, with lifecycle management and the required execution environment. |

Check the entire lifecycle. In releases that expose them, distinguish `agent_end`, `agent_before_settle`, and `agent_settled`. Do not mark work complete at an earlier event while continuation, recovery, compaction, or queued work remains.

When using the SDK, explicitly provide the child session's workspace, resources, model configuration, tools, and lifecycle services. Verify whether the locked SDK loads the same built-in extensions as the CLI. When using RPC, distinguish accepted or handled input from completed agent work. Test event subscription ordering, stream framing, backpressure, immediate completion, and full process-tree cancellation.

Start long-lived resources at the correct lifecycle boundary. Implement idempotent cleanup. Verify reload, shutdown, aborted turns, nested tool calls, parallel calls, headless operation, and mode-specific UI restrictions. Confirm that accounting includes nested model work.

Preserve Pi's working native behavior while providing the pstack interaction contract. Resolve command conflicts explicitly. Use truthful product identity. Keep the user's workflow intact instead of exposing internal translation steps.

Record necessary host translations in a reviewed mapping limited to Pi's launcher, truthful host identity, and equivalent host-owned locations. Preserve pstack command spelling, action order, defaults, gates, and all other stable observations. Retain original and translated observations. This mapping cannot authorize a missing control, added manual step, reduced capability, or weaker outcome.

Keep original source provenance and licenses. Translate host-specific operations into tested Pi bindings. Preserve instructional semantics and progressive disclosure. Do not leave unresolved Cursor paths, nonexistent tool names, inert hooks, or instructions that depend on tools Pi never received.

Follow the locked Pi package rules for resource declarations, runtime dependencies, host-provided peer dependencies, module identity, project trust, and local versus managed installation. Verify the package's actual files. Do not depend on undeclared modules or files available only in the implementation checkout. Use the current package namespace and schema library instead of copying obsolete imports.

## 7. Implement every dependency-backed behavior

Build vertical slices that end with a real user journey. At the start of each slice, name its requirements, owner, isolated writable state, shared dependencies, expected result, and check. Keep the complete acceptance target intact across slices.

Preserve these contracts wherever the source uses them.

**Routing and interaction.** Preserve explicit commands, natural-language triggers, agent and skill distinctions, mode activation, sticky behavior, one-message behavior, opt-out, routing precedence, clarifying questions, defaults, and subsequent turns. Do not assume a slash command is equivalent to a persistent mode.

**Delegation.** Run independent workers with their required models, role instructions, reasoning settings, context boundaries, permissions, concurrency, messaging, waiting, cancellation, and artifacts. Preserve panel sizes, order, and model-family diversity. Different role labels on one model do not establish model diversity. Sequential calls do not establish parallel execution.

Preserve the locked source's alias and fallback policies as written. Do not turn an example worker limit, an old default panel, or a local resource limit into a new product restriction. Verify the physical model used by each required role.

**Isolation and remote execution.** Reproduce required filesystem, process, network, branch, and machine boundaries. Separate worktrees do not establish machine isolation. Where the reference continues remotely after the terminal closes, provide an actual supervised Pi execution environment that does the same. Verify liveness and reconnection through real controls.

**Goals, loops, and subscriptions.** Implement actual scheduling and event delivery. Preserve cadence, dynamic pacing, wake conditions, deduplication, replacement semantics, stop predicates, cancellation, pause, resume, failure recovery, and cleanup. Preserve durations and event conditions exactly. A file describing a timer does not schedule it. Verify behavior with the foreground Pi process closed and after restart wherever the reference requires that persistence.

**History and state.** Preserve the distinctions among conversation history, session branches, task state, goals, worker state, configuration, and cross-session memory. Test compaction, resume, handoff, and configuration changes without losing objectives, permissions, open work, or evidence.

**Verification and control.** Implement real terminal, browser, application, trace, and artifact control for every required control skill. Open and inspect generated artifacts through their intended consumer. Keep read-only workflows read-only. Reproduce defects on their actual control path before fixing them.

**Repository operations.** Preserve PR creation, review, comment handling, CI observation, conflict resolution, stack ordering, freshness requirements, merge authorization, and contiguous verified shipping. Bind review and verification to exact revisions. A new revision invalidates affected evidence.

**Benny and other automations.** Include installation, actual event sources, routing, trust checks, reproducibility requirements, issue deduplication, fresh-checkout resource discovery, existing-fix handling, and controlled activation. Exercise the installed automation and its user-visible result. A generated automation prompt is only one artifact in this workflow.

Preserve workflow-specific details. This includes automation editor review and post-save checks, reproduction counts, subscription replacement rules, and draft-versus-ready PR behavior. Resolve each from its source and reference run. Do not replace distinct workflows with one generic policy.

**External dependencies.** Implement operational integrations for every required service and tool. Preserve authentication, configuration, pagination, rate limits, error reporting, retries, approvals, and returned artifacts. Request sensitive values through appropriate account controls. Keep secrets out of prompts and recordings.

**Engineering discipline.** Preserve required investigations, prototypes, architecture comparisons, independent review, skeptical finding triage, verification, cleanup, and decision trails. Keep the actual benefits of those steps. Renaming a step without executing it is a defect.

## 8. Verify through the user's controls

User-perspective verification is the acceptance authority.

Build a differential end-to-end runner that launches the installed Cursor reference and the installed Pi candidate in equivalent, resettable environments. Feed the same user actions through their real controls. Assert what the user sees and what actually changes.

For terminal workflows, allocate a real PTY. Send actual keystrokes, Enter, Escape, interrupts, pasted multiline text, selection changes, and terminal resizes. Observe the rendered terminal and the resulting application state. Use a real terminal renderer when visual assertions require it.

For browser or GUI workflows, use the real application with browser or computer automation. Click, type, scroll, select, open artifacts, and verify outcomes as the user would. Read-only state inspection may corroborate a result. It cannot replace the user action that produces that result.

SDK, RPC, unit, contract, and integration tests are supporting evidence. They do not replace terminal or GUI journeys. Importing a handler and calling it directly does not prove the command works for a user. A screenshot does not prove the interaction that should follow it.

Use real model providers, tools, workers, and external test accounts for acceptance. Controlled faults and deterministic fixtures may add diagnostic coverage. They cannot stand in for an untested live integration. Test-only branches must not implement behavior absent from the shipped package.

Create concrete scenarios for every discovered entry point, branch, dependency edge, and externally visible state transition. Include these mandatory journey families and expand them from the actual inventory.

1. Install the distributed package in a clean Pi environment, discover commands and skills, complete setup, and run the first task.
2. Re-run setup, change role configuration, preserve unrelated settings, and verify the chosen models during real work.
3. Invoke every command and applicable natural-language trigger. Verify help, arguments, defaults, invalid input, and cancellation.
4. Activate pstack for one message and persistently. Continue across turns, interrupt it, opt out, and verify routing afterward.
5. Execute every playbook through its complete user journey. Include investigation, repair, feature work, refactoring, performance work, authoring, evaluation, autonomous work, orchestration, pickup, pause, cleanup, PR readiness, and shipping behavior discovered in source.
6. Run multiworker designs and reviews. Prove worker independence, model identity, overlapping execution where required, isolated writes, aggregation, failed-worker handling, and cancellation.
7. Interrupt a running task, send new direction, compact context, branch the session, restart Pi, and resume. Verify the correct objective and remaining work.
8. Start durable work, close the terminal, and disconnect the originating test client where the reference continues remotely. Observe actual continuation, reconnect from a fresh client, inspect progress, and cancel without orphaning work.
9. Exercise timers, dynamic subscriptions, CI-event wakes, duplicate names, updates, expiry, cancellation, and restart recovery.
10. Drive PR and stack workflows in controlled repositories with failing CI, review findings, conflicting branches, outdated evidence, and explicit approval changes.
11. Install and trigger Benny and every other discovered automation. Verify deduplication, trusted routing, reproduction, existing-fix handling, and resulting artifacts.
12. Operate each terminal, browser, UI, trace, and artifact control dependency. Open the actual outputs and complete the intended consumer task.
13. Exercise recall, reports, canvases, diagrams, skill creation, workflow extraction, and other generated resources. Verify discovery and reuse afterward.
14. Reload, update, disable, re-enable, remove, and reinstall the package. Verify settings, sessions, subscriptions, and unrelated Pi behavior.
15. Exercise denied permissions, expired authentication, unavailable models, timeouts, network loss, malformed inputs, tool errors, worker crashes, cancellation races, and duplicate events. Verify recovery and absence of unintended effects.
16. Combine workflows in longer sessions. Check for state leaks, stale modes, duplicate side effects, configuration drift, and growing resource usage.

For each execution, retain the fixture digest, source lock, candidate revision, installed package digest, deployment manifest digest, environment configuration, actual user inputs, timestamps, terminal or screen recording, observed intermediate states, external effects, assertions, and verdict. Redact credentials while preserving useful evidence.

Every parity verdict requires a linked Cursor-and-Pi run pair. Record a pair identifier, both run identifiers, both environment fingerprints, both fixture digests, literal input sequences, comparator version, normalization rules, trace digests, and the difference report. Reject a missing side or any unexplained difference in inputs or fixtures. A Pi-only recording cannot close a parity requirement.

Create a deployment manifest that pins every operational component. Include worker images, companion services, scheduler builds, adapters, resource bundles, configuration schema versions, and runtime configuration identities. Keep secret values outside the manifest. Package evidence is stale when a participating operational component changes.

Measure the aspects of feel that affect use. Compare action count, interaction order, default choices, status feedback, time to first feedback, cancellation response, waiting behavior, and task completion. Measure performance under comparable workloads and environments. Set comparison rules from reference evidence before evaluating the candidate. Do not hide failures behind averages.

Repeat model-dependent and timing-dependent journeys under a declared protocol. Keep all attempts, including failures. Do not rerun until one lucky attempt passes. Add held-out tasks, varied user wording, and unexpected action sequences. An independent verifier retains the undisclosed held-out corpus and executes it after the candidate digest is frozen. Keep exact contracts exact.

Use independent evaluators for judgment about workflow quality and interaction fidelity. Give them the reference and candidate evidence without identifying which produced which when practical. They must explain each mismatch with a reproducible action and consequence. A favorable opinion cannot override a concrete failed assertion.

## 9. Make evidence control completion

Implement an executable completion gate. It must validate the source lock, dependency closure, requirement coverage, installed artifact, scenario results, evidence integrity, and review results.

The gate must fail for an empty inventory, unresolved dependency, unmapped source behavior, missing scenario, omitted test, unexecuted test, unsupported evidence claim, stale revision, missing recording, failed assertion, outstanding mismatch, or unresolved review finding.

Compute coverage over the full requirement-by-configuration matrix. A successful default case does not close an untested override, platform, optional feature, failure, or recovery case. Do not redefine 100% as the fraction of a selected subset that happened to execute.

Each requirement begins unverified. Only the verification runner may write a passing result, and only after executing the corresponding journey against the current installed artifact. Protect acceptance definitions and raw evidence from casual implementation edits.

Test the gate itself by deliberately introducing representative omissions and behavior regressions in an isolated candidate. Confirm that it detects a missing command, wrong default, lost approval, fake worker, broken persistence, and stale evidence. Remove those deliberate faults and reverify the repaired artifact.

Commission independent source-closure and user-journey reviews. Preserve the source workflows' required model diversity. Reviewers must read the relevant sources and operate the installed package. Self-review, a renamed persona, and a summary of tests are not substitutes for required independence.

Review correctness, permissions and data integrity, verification, coupling, and reader load. Each finding must identify the triggering user action, consequence, and evidence. Fix accepted findings and rerun affected journeys. Apply Unslop and No-comments while preserving licenses and necessary external constraints.

During development, rerun affected journeys after each repair. For final delivery, run the full acceptance suite against the exact final package and deployment manifest from clean installations. Any later production package, service, worker, resource, or operational configuration change requires a new full acceptance run. Keep generated evidence outside the immutable runtime payload. Deliver exactly the verified payload.

## 10. Preserve progress until the target is satisfied

Keep `parity/progress.md` current with the objective, source lock, requirement counts, owners, design decisions, open mismatches, last verified revision, and exact next executable action.

Use supported concurrent workers for independent work. Give each writer a separate branch or worktree and explicit owned files. One coordinator owns integration and the acceptance ledger. Review worker artifacts yourself.

Finish each slice with a working user journey and a recoverable checkpoint. Preserve the complete task contract across context compaction, handoffs, and sessions. A checkpoint is a continuation artifact, never a completion substitute.

At each continuation, inspect the current repository, read the ledger and evidence, confirm the artifact revision, run the relevant smoke journey, and resume the highest-priority unsatisfied requirement.

When the hosting harness supports continuation jobs, configure and verify the actual continuation mechanism within the operator's authorization. A promise in a response does not start a background worker.

Report concise progress with concrete completed journeys, observed mismatches, repairs, and the next action. Do not end at a research report, a design document, a test plan, or an offer to implement later.

## 11. Deliver the verified package

Deliver all of the following as working, inspectable artifacts.

- The complete Pi package, source, dependency lock, resource declarations, required services, and preserved license notices.
- Exact installation, upgrade, removal, configuration, and use instructions that you have followed in a clean environment.
- The immutable reference lock and complete dependency graph.
- The requirement ledger with every required behavior mapped to source, implementation, scenario, and current evidence.
- The actual end-to-end runner, fixtures, recordings, reports, and reproducible acceptance command.
- The independent review results and resolutions.
- A maintainer guide for updating upstream sources, discovering new dependencies, regenerating requirements, and preventing regressions.

Generate `parity/completion.json` from the gate. It must identify the tested Cursor reference, Pi version, source revisions, candidate revision, package digest, deployment manifest digest, acceptance-definition hashes, configuration matrix, requirement count, executed journey count, evidence index, and final verdict.

The success predicate is conjunctive. Every required behavior is implemented. Every dependency is resolved. Every required user journey passes against the shipped artifact. Every approval and lifecycle contract is preserved. Every required independent review is satisfied. There are zero omitted requirements, zero unverified requirements, zero failing journeys, and zero unresolved mismatches.

Only after that predicate is true, give the final delivery response. Lead with the installable artifact and exact command to use it. Show how to invoke pstack in Pi. Link the evidence and state the verified source revisions and package digest. Explain what the user can now do and what the maintainer can rerun.

Start now. Inspect the real sources and execution environment, construct the dependency and requirement ledgers, capture the first Cursor user journey, and begin implementing its Pi-native equivalent. Continue through the complete acceptance gate.
