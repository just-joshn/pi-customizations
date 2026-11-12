# Pi-native pstack: complete parity architecture and implementation specification

Architecture proposal · November 11, 2026 · Based on current upstream source

## 1. Executive design decision

Build pstack as a native Pi package containing the original pstack skills, a thin TypeScript extension, and a tmux-backed Pi worker orchestration mechanism.

Do not fork Pi. Do not reproduce Cursor's internal architecture. Do not add subagents, plan mode, a task database, permission popups, or background shell execution to Pi's core.

Instead, preserve pstack's engineering workflows and observable behavior while expressing them entirely through Pi's supported mechanisms.

Recommended architecture

Pi interactive session

Native slash commands · Skills · Model selection · Session history

pstack Pi extension

Command entry points · Workflow routing · Adapter tools · Lifecycle integration

Upstream skills

34 workflow skills, 24 principles, 23 playbooks, scripts and references

Pi-native services

Built-in MCP · Codemode · RPC · Session APIs · Extension hooks

tmux-managed independent Pi processes

Multi-model workers · Parallel review · Swarms · Autopilot · Resumable runs

Files and real-world outcomes

TODO.md · Plans · Git worktrees · PRs · Verification evidence · Decision logs

The key distinction is that pstack is the workflow specification; Pi supplies the execution mechanisms. Cursor becomes neither an architectural dependency nor a compatibility runtime.

This is consistent with Pi's stated position that workflow-specific behavior belongs in extensions, skills, prompt templates, and packages rather than the core. Pi's current fork also includes built-in MCP and Codemode.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ccn.web.tr\&sz=32)

GitHub+1



### What 100% parity means

The acceptance target is full behavioral and workflow parity, not identical internal implementation.

For every upstream capability, the Pi implementation must preserve its inputs, intended decisions, required steps, side effects, artifacts, recovery behavior, and externally observable outcomes.

A different mechanism is acceptable only when it produces an equivalent result without violating Pi's principles.

There is one important qualification. Cursor-specific hosted services, proprietary review results, and models unavailable through Pi cannot be made literally identical by an extension alone. The architecture must provide an independently functional equivalent, distinguish that equivalent from the original service, and prove its behavior with tests.

Therefore, 100% is a release acceptance target, not a status that can honestly be claimed before implementation and parity testing.

## 2. Verified upstream baseline

I inspected the following source revisions.

| Source                                                                                                | Frozen reference     | Role                                                     |
| ----------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------- |
| [earendil-works/pi](https://github.com/earendil-works/pi?utm_source=chatgpt.com)                      | `d78a75ecb26d`       | Pi runtime, documented APIs, design boundaries           |
| [Cursor pstack](https://github.com/cursor/plugins/tree/main/pstack?utm_source=chatgpt.com)            | `5866df557357`       | Original workflows, principles, scripts, automation pack |
| [Cursor Team Kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit?utm_source=chatgpt.com) | Same Cursor revision | Required supporting skills and tooling                   |

At this revision, the two pstack plugin manifests report version `0.15.36`. The inspected source includes 34 main workflow-skill directories, 24 principle-skill directories, 23 playbook files, two agent definitions, and the Benny automation pack.

The canonical specifications are the actual source files, not the README summaries. Particularly important are [poteto-mode/SKILL.md](https://github.com/cursor/plugins/blob/5866df557357d005b3c0c9d3da0d9e739b4bdde3/pstack/skills/poteto-mode/SKILL.md?utm_source=chatgpt.com), its `playbooks/` and `references/` directories, and the bundled executable scripts.

The package must preserve their original semantics. It must not silently omit a step just because that step references Cursor.

## 3. Pi's design principles are hard constraints

Every feature is classified against the constraints before implementation. A failing constraint rejects the implementation, not the feature requirement.

| Pi design boundary           | Prohibited solution                                             | Required Pi-native implementation                                                                                       |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Minimal, extensible core     | Fork Pi or modify its agent loop for pstack                     | Distributable Pi package, extension, skills and prompt templates                                                        |
| Built-in MCP                 | Build a competing MCP client or transplant Cursor's MCP runtime | Pi's existing MCP configuration, discovery, authentication and tool exposure                                            |
| Built-in Codemode            | Build a second JavaScript tool-composition sandbox              | Pi Codemode for composing existing tools and reducing result volume                                                     |
| No built-in subagents        | Add Cursor `Task` or a subagent scheduler to Pi core            | Independent, ordinary Pi processes launched and observed through tmux                                                   |
| No permission popups         | Add tool-by-tool approval middleware or approval dialogs        | OS or container isolation, trusted project loading, and explicit workflow-level authorization for consequential actions |
| No plan mode                 | Add an agent execution mode named Plan                          | Ordinary Markdown plans written to disk, with validation and explicit execution gates                                   |
| No built-in todos            | Create a global task service or hidden to-do system             | `TODO.md`, with evidence-backed state changes                                                                           |
| No background bash           | Detached shell commands managed invisibly by Pi                 | tmux sessions containing real processes with inspectable output                                                         |
| Simple, observable execution | Replace Pi's tools and sessions with an opaque framework        | Reuse native tool events, session history, RPC and terminal output                                                      |
| Adapt Pi through extensions  | Depend on Cursor or patch undocumented runtime internals        | Public extension APIs and isolated adapters only                                                                        |

No extension can claim to sandbox another Pi process merely by intercepting its tool calls. Pi's security documentation states that the operating system determines tool permissions. Project trust controls loading project resources, not the privileges of an already-running process.

The recommended unattended deployment therefore places workers inside an isolated container, micro-VM, or equivalent supported environment. Interactive project trust remains Pi's native mechanism. It is not replaced with a second approval system.

References: [Pi extensions](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/extensions.md?utm_source=chatgpt.com), [security](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/security.md?utm_source=chatgpt.com), [containerization](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/containerization.md?utm_source=chatgpt.com).

## 4. Complete pstack capability inventory

The implementation must not reduce pstack to a small collection of prompt templates. The original package contains several different kinds of functionality, each requiring the correct Pi mechanism.

### 4.1 All 34 primary skills

Every primary skill must remain available under its original name and preserve its routing conditions and output contract.

| Functional area                 | Skills                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main engineering workflow       | `poteto-mode`, `poteto-help`, `setup-pstack`, `figure-it-out`                                                                                                                 |
| Investigation and reasoning     | `how`, `why`, `teach`, `recall`, `blast-radius`                                                                                                                               |
| Design and parallel exploration | `architect`, `arena`, `swarm`, `interrogate`, `statechart`                                                                                                                    |
| Correctness and verification    | `tdd`, `correct`, `benchmark-checklist`, `create-verification-skill`, `maintain-verification-skill`, `create-formal-verification-skill`, `maintain-formal-verification-skill` |
| Quality and communication       | `no-comments`, `unslop`, `technical-writing`, `typescript-best-practices`, `show-me-your-work`                                                                                |
| Personalization and improvement | `automate-me`, `reflect`, `sharpen`                                                                                                                                           |
| Recaps and output formats       | `ketchup`, `ketchup-video`, `bro`, `in-your-own-words`                                                                                                                        |
| Other specialized workflows     | `make-bot-ui`                                                                                                                                                                 |

All of these need their supporting files as well as their `SKILL.md`. Native Pi can discover Agent Skills directly, so the core content requires no second skill-loading engine.

### 4.2 All 24 principle skills

Preserve all 24 `principle-*` directories. They remain individually loadable, including their specific triggers and original decision rules.

Core

Laziness Protocol, Foundational Thinking, Redesign from First Principles, Attack the Premise, Subtract Before You Add, Minimize Reader Load, Outcome-Oriented Execution, Experience First, Exhaust the Design Space, Build the Lever.

Architecture

Model the Domain, Boundary Discipline, Type System Discipline, Make Operations Idempotent, Migrate Callers Then Delete Legacy APIs, Separate Before Serializing Shared State.

Verification

Prove It Works, Fix Root Causes, Sequence Work into Verifiable Units, Test Behavior Not Implementation, Explain the Number.

Delegation and meta

Guard the Context Window, Never Block on the Human, Encode Lessons in Structure.

The active `poteto-mode` skill must retain the rule that an applicable principle's leaf skill is read before the agent claims to have applied it.

### 4.3 All 23 playbooks

The original files remain the normative workflow definitions. Pi's `TODO.md` substitutes for Cursor's task list without changing the required sequence.

| Playbook family          | Original playbooks                                           |
| ------------------------ | ------------------------------------------------------------ |
| Research and diagnosis   | Investigation, Runtime forensics, Trace forensics            |
| Building                 | Feature, Bug fix, Refactoring, Perf issue, Hillclimb         |
| Design and experiments   | Prototype, Visual parity, Eval, Authoring a skill            |
| Delivery                 | Opening a PR, Babysit, Shipping                              |
| Long-running execution   | Autonomous run, Orchestrate, Autopilot-full, Autopilot-stack |
| Continuity and lifecycle | Session pickup, Pause safely, Worktree cleanup               |
| Planning                 | Multi-phase or multi-PR plan                                 |

The distinction between these workflows is material. For example, `Babysit` stops at merge-ready, whereas `Shipping` performs a separate independent-verification and merge procedure. Combining them would break parity.

### 4.4 Agents, scripts, and automation

The two Cursor agent definitions become independent Pi worker role instructions, not new agent types. `poteto-agent` retains its required skill reading and delegated task behavior. `comment-sicko` retains its comment-review scope and reporting contract.

The executable source is also in scope:

- The GitHub `watch-pr` watcher, parser, policies, fixtures and tests.
- The `check-plan.mjs` validator and tests.
- The worktree audit and decision-log scripts.
- The TLA+ statechart engine, rendering backends, fixtures and tests.
- The Benny issue-triage and reproduction automation pack.
- Any referenced scripts, assets and reference documents under the skills.

These are first-class requirements, not optional attachments.

## 5. Dependency replacement specification

The following table establishes the preferred adapter for each Cursor-specific capability.

| Cursor dependency or behavior         | Pi-native equivalent                                                                            | Required parity condition                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Cursor `Task`                         | `pstack_worker` extension tool launching a separate Pi process in tmux                          | Distinct worker context, explicit brief, model, workspace, result, cancellation and recovery |
| `poteto-agent` and `generalPurpose`   | Pi worker roles initialized with different instruction documents                                | Preserve the caller's selected role and all mandatory skill reads                            |
| Cloud subagent                        | Pi worker in isolated container or remote provisioned environment, supervised through tmux      | Reproducible environment, independent filesystem, exact branch/SHA, live evidence            |
| `run_in_background`                   | Return a tmux worker identifier immediately                                                     | Parent can continue, observe, steer and collect results without a hidden bash job            |
| Cursor's task list                    | `TODO.md`                                                                                       | Original playbook steps copied in order, verbatim, before task-specific work                 |
| Cursor Plan mode or planner artifacts | Markdown plan on disk                                                                           | Validation, explicit go/no-go, no implementation during plan-only requests                   |
| Cursor `/loop`                        | tmux-managed predicate watcher and wakeup mechanism                                             | Stop predicates, periodic audit, reattachment, durable progress                              |
| Cursor `AskQuestion`                  | Pi's existing user input methods where UI is available, otherwise ordinary conversational input | Preserve true decision gates without a new tool-approval system                              |
| `.cursor/rules/pstack-models.mdc`     | `~/.pi/agent/pstack/models.json`                                                                | Same roles, budgets, candidate multiplicity, inheritance and fallback rules                  |
| Cursor Agent Skills                   | Native Pi Agent Skills                                                                          | All skill names, references, explicit invocation and routing behavior                        |
| Cursor agent transcripts              | Pi's persisted session records and session tree                                                 | Workspace-scoped history, ordering, evidence and resumability                                |
| Cursor Project tracker/store          | Project Markdown files, native session history and attached artifacts                           | Durable decisions, assignments, ownership and restart recovery                               |
| Cursor MCP integrations               | Built-in Pi MCP                                                                                 | Same relevant services and authorized operations when configured                             |
| Cursor tool composition               | Built-in Pi Codemode                                                                            | Parallel calls, filtering and evidence reduction                                             |
| Cursor's built-in `create-skill`      | Pi's documented Agent Skills authoring and validation                                           | Valid frontmatter, resolvable references and executable validation                           |
| `cursor-team-kit/deslop`              | Port its existing skill into Pi                                                                 | Required pre-commit cleanup remains enforced                                                 |
| `cursor-team-kit/control-cli`         | Port its skill, using tmux or an existing PTY harness                                           | Real CLI/TUI interaction and evidence                                                        |
| `cursor-team-kit/control-ui`          | Port its skill, using existing Playwright or CDP tooling                                        | Real browser/Electron behavior, screenshots and trace evidence                               |
| Cursor built-in PR tool               | Available Pi MCP forge tool, or `gh`/Origin CLI                                                 | Same PR lifecycle and preservation of forge metadata                                         |
| Cursor Bugbot                         | Ingest actual review comments when available; otherwise run a separate independent review       | Do not fabricate Bugbot findings or label substitutes as Bugbot                              |
| Cursor Automations                    | Pi worker plus explicit event source and tmux-managed scheduler                                 | Trigger handling, idempotency, original thread identity and equivalent resulting actions     |
| Cursor webhook hosting                | User-controlled webhook receiver and authenticated forwarding                                   | No dependency on Cursor's hosted webhook URL                                                 |
| Cursor cloud-specific file paths      | Explicit per-worker artifact directory and worktree                                             | No references to inaccessible Cursor filesystem locations                                    |

Architectural rule: a dependency should be ported only to the extent that pstack calls it, unless its own nested dependency requires more. That avoids silently dropping necessary functionality without importing unrelated Cursor products.

The initial mandatory transitive skill set is `deslop`, `control-cli`, and `control-ui`. A generated dependency manifest must discover any additional referenced Cursor skills or built-ins before packaging. Unknown dependencies fail the build rather than quietly becoming generic agent instructions.

## 6. Package layout and ownership

The package should have one implementation of each responsibility. Original source is retained for auditing, while Pi-adapted skills are generated from it.

```
pi-pstack/
├── package.json
├── package-lock.json
├── README.md
├── CHANGELOG.md
├── src/
│   ├── extension.ts
│   ├── commands.ts
│   ├── skill-routing.ts
│   ├── models.ts
│   ├── workers.ts
│   ├── rpc-client.ts
│   ├── run-files.ts
│   ├── forge.ts
│   ├── evidence.ts
│   └── worker-host.ts
├── adapters/
│   ├── cursor-to-pi.ts
│   ├── dependencies.ts
│   ├── skill-transforms.ts
│   ├── model-config.ts
│   ├── automation-events.ts
│   └── provenance.ts
├── vendor/
│   ├── upstream-pstack/
│   │   ├── skills/
│   │   ├── agents/
│   │   ├── automations/
│   │   └── docs/
│   └── upstream-cursor-team-kit/
│       └── skills/
├── generated/
│   ├── skills/
│   ├── prompts/
│   ├── dependency-manifest.json
│   ├── transformation-manifest.json
│   └── upstream-lock.json
├── tests/
│   ├── skill-parity/
│   ├── worker-lifecycle/
│   ├── workflow-parity/
│   ├── model-routing/
│   ├── mcp-codemode/
│   ├── security/
│   ├── recovery/
│   └── fixtures/
└── scripts/
    ├── sync-upstream.mjs
    ├── compile-skills.mjs
    ├── check-parity.mjs
    ├── check-dependencies.mjs
    └── run-e2e.mjs
```

The published manifest uses Pi's native package declaration:

```

{
  "name": "@your-scope/pi-pstack",
  "version": "0.15.36-pi.1",
  "type": "module",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./src/extension.ts"],
    "skills": [
      "./generated/skills"
    ],
    "prompts": [
      "./generated/prompts/*.md"
    ]
  }
}

```

`@your-scope` is a placeholder for the eventual publisher, not an existing published package. Exact pinned third-party runtime dependencies are added under `dependencies` only when source analysis proves they are needed.

Pi supplies its own libraries to extensions. They belong in `peerDependencies`, not bundled copies. That requirement is explicit in [Pi's package documentation](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/packages.md?utm_source=chatgpt.com).

### One immutable source, one executable adaptation

Do not manually fork 58 skill files and maintain them forever.

Instead:

1. Import upstream at the pinned Git commit and preserve the original contents.
2. Parse every skill's frontmatter, references, scripts and routing directives.
3. Apply only reviewed Cursor-to-Pi substitutions to a generated copy.
4. Record every changed source span in `transformation-manifest.json`.
5. Reject an upstream update when a changed instruction cannot be mapped explicitly.
6. Compare the generated skill's required steps, invariants and outputs against its source.

A broad search-and-replace of terms such as `Task`, `Cursor`, or `.cursor` is forbidden. Those terms can occur in explanations, examples, or instructions with different meanings. Substitutions must be aware of the instruction they modify.

This provides traceability without introducing an ongoing hand-maintained parallel workflow library.

## 7. Domain model

The extension needs a small, explicit domain model rather than scattered JSON objects.

```

type RunId = string & { readonly __brand: "RunId" };
type WorkerId = string & { readonly __brand: "WorkerId" };
type CommitSha = string & { readonly __brand: "CommitSha" };

type WorkerRole =
  | "poteto"
  | "explorer"
  | "investigator"
  | "candidate"
  | "judge"
  | "verifier"
  | "reviewer"
  | "owner"
  | "watcher";

type WorkerState =
  | { kind: "created" }
  | { kind: "starting"; tmuxSession: string }
  | { kind: "running"; tmuxSession: string; sessionFile: string }
  | { kind: "completed"; reportPath: string }
  | { kind: "failed"; reason: string; recoverable: boolean }
  | { kind: "aborted"; reason: string };

type EvidenceVerdict =
  | { kind: "pass"; receipts: string[] }
  | { kind: "fail"; receipts: string[]; defects: string[] }
  | { kind: "inconclusive"; reason: string; receipts: string[] };

interface WorkerAssignment {
  id: WorkerId;
  runId: RunId;
  role: WorkerRole;
  briefPath: string;
  model: string;
  thinkingLevel: string;
  worktreePath: string;
  inputCommit: CommitSha;
  writable: boolean;
  state: WorkerState;
}

```

These are proposed domain contracts, not claims that Pi already exposes these types.

The extension owns a run's identity, role assignment, output paths and lifecycle. Pi owns each process's model execution, session transcript, tool behavior, MCP access and compaction.

### Persistent data layout

```
.pi/pstack/
├── models.json
├── plans/
│   └── <program-slug>.md
└── runs/
    └── <run-id>/
        ├── run.json
        ├── TODO.md
        ├── decisions.tsv
        ├── events.jsonl
        ├── workers/
        │   └── <worker-id>/
        │       ├── brief.md
        │       ├── state.json
        │       ├── report.md
        │       └── evidence/
        └── verification/
            └── verdicts.json
```

`run.json` is the authority for run identity, ownership, immutable source revisions and execution configuration. `TODO.md` is the authority for human-readable workflow steps. `events.jsonl` is an append-only operational trail. Native Pi session files remain the authority for conversations.

Do not create a separate SQLite task database, transcript format or session-history service.

### Core invariants

The implementation must enforce the following:

1. One worker owns a writable worktree at a time.
2. One active babysitter owns a PR stack's merge frontier.
3. A verification verdict identifies the exact code and environment it examined.
4. An absent result or inconclusive verification never becomes a pass.
5. A completed task has an evidence receipt, not merely an agent assertion.
6. A retry cannot duplicate a committed side effect.
7. The parent owns the playbook. Workers only execute their assigned portions.
8. Pausing cannot silently destroy a worker's uncommitted state.
9. A worker cannot gain access to secrets or tools outside its declared environment.
10. Stopping and restarting the extension cannot erase unfinished work.

## 8. Pi extension integration

The extension should register a minimal set of executable capabilities and leave reasoning instructions in skills.

### 8.1 Native extension hooks

| Pi API               | pstack responsibility                                                                |
| -------------------- | ------------------------------------------------------------------------------------ |
| `resources_discover` | Publish generated skills and prompts when required                                   |
| `registerCommand`    | Setup, status, pause, resume, audit and worker-control commands                      |
| `input`              | Route exact pstack slash names to native skill commands                              |
| `before_agent_start` | Apply an explicitly enabled persistent pstack style and current run context          |
| `session_start`      | Restore scoped run context and inspect live workers                                  |
| `session_shutdown`   | Release extension-owned resources without killing independently running tmux workers |
| `agent_settled`      | Record that a parent agent has become idle                                           |
| `registerTool`       | Expose bounded worker and evidence operations                                        |
| `appendEntry`        | Store compact audit metadata in Pi session history                                   |
| `getAllTools`        | Discover available MCP and extension capabilities                                    |
| `registerMcpServer`  | Register only an optional server that native configuration does not already supply   |

The extension should not intercept every `bash` or `tool_call` event to implement a shadow permission or policy engine.

### 8.2 Slash-command parity

Every original skill must be discoverable and callable.

The canonical fallback is Pi's native `/skill:<name>` form, for example `/skill:poteto-mode`, `/skill:arena`, and `/skill:swarm`.

The distribution should also provide the original user-facing names, such as `/poteto-mode`, `/arena`, `/how`, `/why`, and `/setup-pstack`. Generated Pi prompt templates or explicit input routing can implement those aliases.

The preferred approach is:

- Use a generated prompt template when a command needs only reusable instructions.
- Use native skill loading for long instructions and supporting files.
- Use an extension command when execution or lifecycle management is required.
- Preserve the original command name unless it conflicts with an existing command.
- In the event of a conflict, retain a namespaced `pstack:` alias and report the conflict during installation.

For an input alias that is not owned by an extension command, Pi's documented `input` event can transform the original command into `/skill:<name>` before skill expansion. Preserve user arguments and attached images.

Do not reproduce Pi's skill discovery, command palette or prompt-expansion logic.

### 8.3 Persistent pstack style

Cursor's persistent agent-style behavior is a workflow concern. It does not require a new Pi execution mode.

Proposed commands:

```
/pstack on
/pstack off
/pstack status
/pstack doctor
/pstack workers
/pstack pause <run-id>
/pstack resume <run-id>
/pstack audit <run-id>
```

When enabled, the extension records the selection in the native session and loads the full pstack instructions at task boundaries. When disabled, Pi returns to its ordinary behavior.

The implementation must handle compaction, session resume and fork correctly. It must not add the entire pstack document again on every tool turn, wasting the context window.

An ordinary `/poteto-mode <task>` remains an explicit, task-scoped invocation even when persistent style is off.

### 8.4 Minimal executable tools

Start with one worker lifecycle tool and one evidence tool.

```
type WorkerOperation =
  | { action: "spawn"; runId: string; assignmentPath: string }
  | { action: "inspect"; workerId: string }
  | { action: "steer"; workerId: string; message: string }
  | { action: "abort"; workerId: string }
  | { action: "collect"; workerId: string };

type EvidenceOperation =
  | { action: "record"; runId: string; receiptPath: string }
  | { action: "verify"; runId: string; target: string }
  | { action: "list"; runId: string };
```

Use TypeBox to validate these requests. Reject paths outside the run's authorized directory. Validate worker identifiers and tmux session names at the boundary.

Expose these tools through Pi's `codemode` exposure where composition is useful. Avoid declaring dozens of worker-management tools to the model when one typed interface suffices.

## 9. Worker execution: Pi in tmux

This is the most consequential part of the design.

### 9.1 Select the supported execution pattern

Compare three approaches.

| Approach                                | Observability                         | Control reliability                               | Native Pi reuse | Decision                                                                         |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| Send keystrokes to Pi's interactive TUI | Excellent                             | Fragile under rendering, focus and prompt changes | High            | Reject as the automation protocol                                                |
| In-process Pi SDK workers               | Good through custom UI                | High                                              | High            | Reject for primary workers because it does not meet the tmux-process requirement |
| Pi RPC process inside a tmux session    | Excellent with a terminal-facing host | High through structured RPC                       | High            | Select                                                                           |

Each worker is a real Pi process. A small terminal-facing host starts it in RPC mode, forwards structured commands, displays activity, and keeps the session attached to tmux.

Worker runtime

Parent Pi extension

Bounded local control connection

tmux session `pstack-<run>-<worker>`

Worker host with readable live events and interactive controls

Ordinary `pi --mode rpc` child process

Native Pi session JSONL + worker evidence files

The worker host is an adapter, not a replacement agent runtime. It never reasons about code or executes model tools on Pi's behalf.

### 9.2 Launch protocol

Conceptually:

```
tmux new-session -d \
  -s pstack-<run-id>-<worker-id> \
  -- node <installed-worker-host> <assignment-file>
```

The host starts the installed Pi executable in the assigned worktree using the documented RPC interface.

```
pi --mode rpc
```

The actual implementation passes the appropriate working directory, model, resource configuration and session options through documented Pi CLI arguments.

The parent uses `pi.exec("tmux", args, options)` without constructing a shell command from model-supplied text.

### 9.3 Structured control protocol

The host uses Pi's existing JSONL commands:

| Operation                    | Native Pi mechanism                                   |
| ---------------------------- | ----------------------------------------------------- |
| Start work                   | RPC `prompt`                                          |
| Correct work in progress     | RPC `steer`, or queued `prompt`                       |
| Append work after completion | RPC `follow_up`                                       |
| Request current state        | RPC `get_state`, `get_messages`                       |
| Stop active work             | RPC `abort` and queue cleanup                         |
| Select model                 | RPC `set_model`                                       |
| Set reasoning                | RPC `set_thinking_level`                              |
| Resume context               | Native session persistence                            |
| Observe results              | RPC event stream, persisted transcripts and artifacts |

Each request uses a unique correlation ID. A successful prompt acceptance is not treated as completed work. Completion is established from the appropriate run-settled events and actual evidence.

Native RPC is documented in [Pi RPC Mode](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/rpc.md?utm_source=chatgpt.com) and [RPC Commands](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/rpc-commands.md?utm_source=chatgpt.com).

### 9.4 Human observation and interaction

Every live worker must have a usable tmux session.

An operator can attach, inspect output, inspect the real Pi transcript, send a steering instruction through the worker host, interrupt the process, and detach without ending it.

The extension prints the exact attachment command, for example:

```
tmux attach -t pstack-<run-id>-<worker-id>
```

Use a distinct tmux socket/server namespace if necessary to avoid collisions with the user's sessions. Never call `tmux kill-server` as general cleanup. Stop only the sessions this package created.

The host must clearly distinguish a Pi response, a model tool call, a host diagnostic, and an operator command. No raw or unstructured terminal text may be mistaken for a successful verification receipt.

### 9.5 Worker lifecycle and recovery

\[mermaid diagram omitted in source]

After restarting Pi, the parent reads its run files, checks the actual tmux sessions and reconciles them with worker state. A lost terminal session is not automatically classified as successful, and a lost control connection must not cause the parent to spawn duplicate writers.

Fresh workers are the default for new tasks, retries and follow-up rounds. Resume an existing worker only when its live state is essential, such as an uncommitted checkout, simulator or running watcher. This preserves the original `poteto-mode` worker-reuse rule.

### 9.6 Concurrency and isolation

Every writable worker gets its own Git worktree. Read-only investigations may use immutable repository snapshots when appropriate.

Workers receive a self-contained brief containing the original goal, their exact scope, the commit to inspect, their required skills, their model, the evidence expected, and their output paths.

The coordinator never shares a mutable working tree among parallel writers. A reviewer uses a separate read-only checkout or isolated environment. The reviewer does not inherit the author's unverified assertions as facts.

## 10. MCP, Codemode, and model routing

### 10.1 MCP stays native

Use Pi's existing `mcp.json` configuration and `/mcp` management. Do not duplicate server discovery or authentication.

Tool integrations are optional according to the task. Source-control work can use `git` and `gh`; other evidence sources can use configured MCP services such as issue trackers, documents, chat, observability and error tracking.

The `why` skill specifically requires distinct evidence categories when available. Its Pi adaptation must discover the available sources, assign independent investigations, and report missing categories rather than claim they were checked.

### 10.2 Codemode composes tool calls

Codemode should handle operations such as searching multiple MCP sources, checking independent PR states, gathering review comments and reducing large results.

Example of the intended pattern:

```

const jobs = [
  tools.mcp__issues__search({ query: "incident" }),
  tools.mcp__docs__search({ query: "incident" }),
  tools.mcp__chat__search({ query: "incident" })
];

const results = await Promise.allSettled(jobs);

for (let i = 0; i < results.length; i++) {
  const result = results[i];
  text({
    source: i,
    status: result.status,
    data: result.status === "fulfilled" ? result.value : String(result.reason)
  });
}

```

This is illustrative. The server and tool names must be discovered at runtime. They are not presumed to exist in a user's Pi environment.

Use Codemode only for composing Pi's already registered tools. It is not a general-purpose operating-system sandbox or a replacement for files and tmux.

### 10.3 Preserve pstack's model roles

`setup-pstack` specifies more than a default coding model. The source defines role groups for code changes, hardest tasks, how/why investigators and synthesizers, arena runners and judges, reflect reviewers, swarm workers, architect runners and interrogate reviewers.

The Pi configuration must support those exact groups.

Proposed configuration:

```

{
  "schemaVersion": 1,
  "budget": "large",
  "roles": {
    "feature, refactoring": "inherit-parent",
    "bug-fix": "inherit-parent",
    "perf-issue": "inherit-parent",
    "hillclimb": "inherit-parent",
    "judgment and prose": "inherit-parent",
    "hardest tasks": "inherit-parent",
    "how explorer": "inherit-parent",
    "how explainer": "inherit-parent",
    "why investigators": "inherit-parent",
    "why synthesizer": "inherit-parent",
    "reflect tooling": "inherit-parent",
    "reflect judgment, divergent, synthesizer": "inherit-parent",
    "arena runners": ["inherit-parent", "inherit-parent"],
    "arena cross-judge pool": ["inherit-parent"],
    "swarm workers": "inherit-parent",
    "architect runners": ["inherit-parent", "inherit-parent"],
    "interrogate reviewers": ["inherit-parent", "inherit-parent"]
  }
}

```

This example is a valid portable initial mapping, not a claim that using the same model for every role satisfies multi-model diversity. Setup must detect available models and offer distinct families where the playbook requires them.

Preserve the original budget choices:

| Budget      | Target effort |
| ----------- | ------------- |
| `unlimited` | `max`         |
| `large`     | `xhigh`       |
| `medium`    | `high`        |
| `small`     | `medium`      |

The source's default Cursor model names remain documented in the provenance file, but must not be passed blindly to Pi.

For each role, the resolver:

1. Enumerates models actually available through Pi's model registry.
2. Resolves the user-selected provider/model and reasoning level.
3. Preserves explicit `inherit-parent` and `auto` semantics.
4. Distinguishes panel cardinality from model diversity.
5. Uses only supported reasoning levels and model variants.
6. Applies the upstream fallback order when the exact role model is unavailable.
7. Reports when a required independent model family cannot be obtained.

The setup flow must preserve existing choices, support reruns without accumulating stale roles, and write an idempotent replacement configuration.

For agent tasks, the `large` budget is a starting level, not permission to ignore per-task difficulty, speed rules or the verification worker's configured model.

## 11. Workflow engine: plans, TODO.md, and execution

A pstack run should remain primarily an agent following a skill, not a compiled state machine that attempts to encode every engineering judgment.

The extension handles only the mechanical guarantees that are unreliable as prose: identity, ownership, workflow-step persistence, process lifecycle, model resolution, evidence references and recovery.

### 11.1 `TODO.md` is the workflow checkpoint

At the start of a run, the parent reads the selected playbook and writes its original numbered steps into the run's `TODO.md`, before adding task-specific steps.

Example structure:

```
# Feature: Add an export command

Source playbook: feature.md
Upstream revision: 5866df557357

## Original playbook steps
- [ ] 1. `how` over the affected subsystem.
- [ ] 2. `architect` for parallel design exploration.
- [ ] 3. Write the throughput checkpoint as four todo items.
- [ ] 4. Delegate code-writing to a worker.
- [ ] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
- [ ] 7. If the design is contested, `interrogate` before shipping.
- [ ] 8. Run Opening a PR.

## Task-specific work
- [ ] Define the export data shape.
- [ ] Characterize existing output behavior.
- [ ] Implement one verifiable change.
- [ ] Prove output compatibility.
```

This illustrates the layout. The actual generator must copy the complete upstream step wording, including nested instructions, not use the abbreviated example above.

Each completion records its supporting evidence. Skipped upstream steps remain visible with an explicit `skip:` reason. A failed verification stays incomplete.

The parent is the sole writer of its run's `TODO.md`. Workers return receipts and recommendations. This eliminates concurrent task-file edits.

### 11.2 Plans are files, not an execution mode

A plan-only request creates a Markdown document under `.pi/pstack/plans/` or a user-specified path.

The document follows the source playbook's complete template and is validated with the existing `check-plan.mjs` script.

The `multi-phase-plan` source has particularly strict requirements:

- Plan generation does not implement the requested change.
- Open factual forks are tested by prototypes before the plan is finalized.
- The plan names an execution playbook and ordered PR units.
- Every PR has unit, live and performance verification.
- The live verification section defines ten concrete lanes, including regression against trunk.
- Baseline and treatment measurements must be comparable.
- Interaction-changing PRs require the operator's screenshot/video review gate.
- Execution starts only after the operator gives the explicit go required by that playbook.

A user asking for a plan must never unexpectedly find the agent creating branches and committing implementation code.

### 11.3 No shadow scheduler

The parent decides which workers to spawn as it follows the playbook. The extension only performs requested lifecycle operations and enforces run ownership.

For longer runs, a tmux-contained monitor checks process state and the declared completion predicate. It wakes the responsible Pi session using a structured message or event. It does not decide what code to write.

Avoid a central background service that assigns tasks autonomously. That would recreate a hidden orchestration framework that Pi intentionally omits.

## 12. Workflow-specific parity contracts

The following behaviors must survive the platform change.

### 12.1 Investigation, `how`, `why`, and `teach`

`how` investigates current architecture. `why` investigates evidence of motivation across available source-control history, tickets, documents, chat, error tracking and observability. `teach` builds an explanation from those two forms of analysis.

The original skill's read-only requirement must be enforced through the worker's available tools and environment, not an instruction-only claim. The `why` workflow must retain MCP access, since a Cursor read-only mode that removes MCP was specifically rejected by its source.

Return file and line references, observed behavior, evidence quality, unknowns and the conclusion. Never invent sources when an MCP service is absent.

### 12.2 `architect`, `arena`, `swarm`, and `interrogate`

| Workflow      | Required behavior                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architect`   | Ground affected systems; request structurally distinct designs through arena; synthesize; proceed unless an explicit design checkpoint was requested |
| `arena`       | Generate independent candidates, assess them against a common rubric, select a base, graft useful differences, then verify the combined result       |
| `swarm`       | Partition coverage or run a declared race, launch workers concurrently, track dropouts, verify evidence and report aggregate results                 |
| `interrogate` | Use independent adversarial reviewers, check actual defects and reject unsupported nitpicks                                                          |

Arena candidates must receive separate writable locations. Swarm reports must preserve the original `PASS`, `ISSUES`, and `BLOCKED` outcome distinctions.

For verification work, the assignment must identify the exact commit and measurement method. An abandoned or invalid worker result does not become a passing lane. One justified replacement may be spawned according to the source skill's retry rule.

A claim of multi-model review requires genuinely different available model families when the original skill requires them. Two labels pointing to the same physical model are not independent model-family verification.

### 12.3 Feature, bug fix, TDD, refactoring, and performance

Feature work begins with code grounding and an explicit data shape. Architectural changes use the `architect` workflow. Implementation is delegated to a fresh worker with a bounded scope.

Bug fixing retains the source order of real-surface reproduction, causal investigation, focused fix, real-surface re-verification and regression evidence. TDD places a failing executable check before the fix when practical.

Refactoring retains a characterized behavior contract. The acceptance criterion is not merely that tests compile or pass, but that the same observable behavior survives and the resulting structure is simpler.

Performance work captures an actual baseline before optimizing. `benchmark-checklist` evaluates measurement integrity. Hillclimb attempts are separately measured, accepted or reverted, with a decision log. A plateau triggers reconsideration, not invented improvement.

### 12.4 Verification and formal methods

`create-verification-skill` creates a project-local Pi skill under `.pi/skills/verify-<app>/`, with a real-app harness and feature map. The resulting skill must itself be run successfully on at least one mapped feature before being accepted.

`maintain-verification-skill` updates the map against changed source and performs a live pass even when the source appears consistent.

Formal verification retains its own model, assumptions, checked properties, counterexamples, reproducible command and tested code references.

The `statechart` skill must still execute the bundled TLA+ workflow and emit its corresponding Mermaid diagrams and defect paths. A generated diagram without actually running the model checker is not parity.

### 12.5 History, personalization, and recaps

The original Cursor transcript paths change to Pi's native persisted session records.

- `recall` reconstructs relevant conversations and validates their conclusions against current repository state.
- `reflect` sends the relevant transcript to independent reviewers, synthesizes proposed structural lessons, and retains the original explicit approval gate before editing skills.
- `automate-me` derives recurring working preferences from available history and produces or revises an Agent Skill.
- `show-me-your-work` maintains decisions and evidence, validates its trail against the transcript, and uses an independent reviewer where required.
- `ketchup` produces a concise recap.
- `ketchup-video` must produce an actual subtitled video artifact, not merely a textual summary.

History access must be workspace-scoped and privacy-aware. Pi session history cannot be assumed to include Cursor's previous cloud-agent conversations. Any migration of those transcripts requires an explicit import or conversion path.

### 12.6 Source scripts and specialized behavior

Preserve `worktree-audit.sh` behavior, replacing only Cursor-specific transcript discovery with Pi session discovery. Continue checking current worktree use, uncommitted changes, merged state and operator-pinned sessions before cleanup.

Preserve the decision-log script and TSV format. Preserve the plan validator and its structural failures. Preserve statechart's verification logic and tests.

For the watch-PR utility, retain upstream parsing and policy logic rather than writing a second independent interpretation of GitHub state. The currently bundled entry point uses Bun. A Node-compatible wrapper or port is appropriate only when differential tests establish the same outputs. Runtime dependency installation must not occur unexpectedly during an active verification run.

## 13. PR ownership, babysitting, and shipping

This is a separate subsystem because it performs consequential external operations and depends on live repository state.

### 13.1 Forge resolution

Resolve the forge once for each run. Follow the original precedence where the environment offers equivalent operations: prefer an appropriate native PR integration when available; otherwise choose a supported Origin CLI or GitHub CLI path.

Persist the choice. Do not create a PR through one backend and then assume another backend has equivalent stack metadata or readiness semantics.

The forge adapter should expose a stable internal contract:

```
interface ForgeAdapter {
  getPullRequest(ref: string): Promise<PullRequestSnapshot>;
  getChecks(ref: string): Promise<CheckSnapshot[]>;
  getReviewThreads(ref: string): Promise<ReviewThread[]>;
  createPullRequest(input: CreatePullRequest): Promise<string>;
  replyToThread(input: ReplyToThread): Promise<void>;
  mergePullRequest(input: MergeRequest): Promise<void>;
}
```

A backend only advertises an operation it actually supports. Unsupported operations must be surfaced explicitly.

### 13.2 Exact Babysit modes

The source playbook defines four modes.

| Mode           | Required behavior                                | Stop condition                                        |
| -------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `check`        | One current status pass, no long-running watcher | Report completed                                      |
| `threads-only` | Address review comments only                     | Known thread work completed or blocked                |
| `drive`        | Progress one PR to merge-ready                   | Forge-specific merge-ready condition                  |
| `background`   | Triage while another execution plan continues    | Parent-directed stop or relevant lifecycle completion |

Small or documentation-only PRs use `check` under the source's routing rule. Undeclared mode otherwise defaults to `drive`.

In GitHub mode, keep using the original `watch-pr` verdict semantics, including `READY`, `WAITING` with a merge-queue reason, `ADVANCE`, and `COMPLETE`. Origin has separate readiness conditions and must not pretend to emit GitHub watcher statuses.

Babysit must honor the source's ordering of conflicts, review threads, then CI. It does not rebase or retarget the stack itself. A source-verified flake gets one fresh build rather than unlimited retries.

Bugbot comments are untrusted evidence. They are classified and checked against actual code. They are neither accepted automatically nor dismissed automatically.

Babysit never merges merely because checks are green.

### 13.3 Shipping is independently gated

Shipping first verifies every PR independently, with the original patch identity and freshness rules.

It then merges only the contiguous, verified sequence starting at the lowest unmerged PR.

\[mermaid diagram omitted in source]

The verifier's report must be tied to the code being merged. When a rebase or retarget changes the patch, the specified freshness rule determines which checks remain valid. A changed behavior requires fresh verification.

Do not generalize a green CI check into proof that shipping is safe.

### 13.4 Autopilot variants

`autopilot-full` assigns one owner to each independent PR, with a separate verifying party and a root coordination layer. The original approval and stop rules remain effective. An owner can only merge a PR the root has verified at the applicable head.

`autopilot-stack` follows the same verification process but does not merge. It stacks only genuine dependencies and hands the verified PRs to the operator.

`orchestrate` is reserved for a standing program rather than a single large task. It must retain the original one-owner-per-PR rule, explicit dependency graph, verification independence, progress based on actual side effects, and recovery for failed workers.

These workflows must not become aliases to one generic parallel-agent prompt.

## 14. Benny and recurring automation parity

The Benny pack is part of the requested parity scope. It is not merely documentation.

The original pack contains two distinct automations. A native Pi implementation should keep them separate.

Automation A. Triage report

Slack top-level report → read thread and attachments → classify → search tracker → update duplicate or create eligible ticket → reply in original Slack thread

Trusted handoff

Immutable source channel and root timestamp, trusted classification marker and configured ownership rules

Automation B. Reproduce and fix

Check existing owner/fix → reproduce twice on real UI → collect screenshots and video → attempt bounded fix if appropriate → verify before/after → optionally create draft PR

### 14.1 Event delivery

The Pi package needs an explicitly configured event source. The preferred design is a webhook receiver or a supported Slack event integration feeding an event file and a tmux-managed Pi automation worker.

A polling adapter is acceptable when webhooks are unavailable, but must track its cursor and deduplicate events. Do not implement both simultaneously by default.

A stable idempotency key is derived from the source channel and original root message timestamp. The root coordinates never change as the case progresses.

### 14.2 Behavioral invariants

Benny's original requirements include one response in the original source thread, its prescribed classification markers, duplicate-ticket handling, ownership checks, real-surface reproduction, existing-fix verification, and evidence-backed draft PR creation.

Its workers must not receive Slack posting credentials. The trusted parent event adapter performs permitted external messages. Secrets remain outside the vendored automation pack.

If source-thread identity, tracker access, the control adapter, or the feature map is missing or uncertain, the affected automation fails closed.

The system must recover correctly from a crash after the external action but before local acknowledgement. Where a provider offers no idempotency key, reconciliation must inspect the destination before retrying, rather than blindly reposting.

The automation can create a draft PR only under the original bounded-fix rules. It never merges or deploys.

### 14.3 Setup and configuration

Benny remains dormant until explicitly configured, matching the original package.

A setup workflow copies or generates the needed automation files under a Pi project-owned directory, preserves existing local configuration, checks conflicts, validates connectors, and runs a harmless test event.

Project-owned configuration and feature maps stay outside the vendored upstream directory. Updates to the packaged automation must not overwrite user data.

### 14.4 Cursor-hosted automation alternatives

The `make-bot-ui` workflow currently references Cursor-hosted automation webhooks.

The Pi-native replacement is a locally or remotely hosted receiver with a secret kept on the server. A browser UI sends requests to that receiver. The receiver forwards verified events to the relevant Pi automation.

This preserves the useful outcome without depending on a Cursor webhook URL or embedding its sender key in client-side code.

It is a functional replacement, not an assertion that Cursor's proprietary hosting has been reproduced.

## 15. Security and operational boundaries

### 15.1 Isolation is external to Pi's permission model

The recommended deployment has a trusted parent Pi session and isolated worker environments.

Trust and authority boundaries

Parent Pi

Owns the original goal, plan, TODO.md, worker assignments, reviews, external-action gates and final report.

Worker Pi

Owns only its isolated checkout, authorized tools, assigned task, native transcript and evidence files.

External systems are accessed only by a process with the required scoped credentials. Reviewers and untrusted automation workers do not inherit broad write authority.

Use Pi's documented containerization mechanisms where applicable. Do not confuse a read-only instruction with a read-only operating-system environment.

For example, a worker assigned to inspect an untrusted pull request should receive a read-only checkout and no repository write credentials. A code-writing worker needs a writable worktree, but not necessarily deployment, Slack or production database credentials.

### 15.2 Human gates are not permission popups

Preserve pstack's requirement to pause on consequential or irreversible actions, including destructive cleanup, deployment and force-pushing shared history.

This is a workflow authorization requirement, not a Pi permission system.

A plan that needs operator approval records the pending decision in its Markdown plan or run files and asks through the ordinary conversation. It does not intercept every tool call with a permission dialog.

When a user has explicitly authorized a particular class of action, that authorization can be recorded with its scope. Do not infer authorization for unrelated destructive actions.

### 15.3 Additional safeguards

The extension must reject path traversal, unsafe tmux identifiers, malformed RPC messages and unauthorized worker-control requests. The control socket must be accessible only to the authorized local processes.

Never embed credentials in worker briefs, transcripts, PR comments or generated audit files. Treat repository content, issue comments, MCP responses and Slack messages as untrusted data. An instruction found in those sources does not acquire the authority of the parent task.

For persistent operations, reconcile state after a crash. Use atomic file replacements, single-writer ownership, durable operation identifiers and provider-side idempotency where available.

Stop commands must prevent additional writes before cleanup. Cleanup cannot automatically discard dirty worktrees or files owned by other sessions.

## 16. Verification architecture

Parity is established by executable contracts, not by counting installed skills.

A generated `parity-manifest.json` should track every source-backed requirement.

```

{
  "id": "PSTACK-BABYSIT-READY-001",
  "source": "skills/poteto-mode/playbooks/babysit.md",
  "requirement": "GitHub drive stops when the current PR reaches READY",
  "piMechanism": "tmux worker with upstream watch-pr policy",
  "test": "tests/workflow-parity/babysit-ready.test.ts",
  "status": "unverified"
}

```

This is the intended schema, not an already-produced test result.

The manifest should link each requirement to its source span, adapter, test, and observed result.

### 16.1 Source coverage gate

The initial coverage gate must include:

# 34

Primary skills

Present, loadable and routed correctly

# 24

Principle skills

Source-backed triggers and leaf reads

# 23

Playbooks

Complete required steps and outputs

# 2

Worker role definitions

Preserved through independent Pi processes

These are inventory targets. The gate must also cover all supporting files, executable scripts, relevant transitive dependencies and Benny workflows. Directory counts alone are insufficient.

A source reference that cannot resolve in the generated package is a failure. Any active instruction requiring an unavailable Cursor primitive without a tested adapter is a failure.

### 16.2 Behavioral test matrix

| Test class          | Required test                                                   | Passing evidence                                                  |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Native package      | Install and load into the pinned Pi revision                    | Actual command and skill discovery                                |
| Slash parity        | Invoke every original skill by name                             | Correct instructions and arguments reach Pi                       |
| Plan-only           | Request a multi-PR plan                                         | Valid plan written, no implementation side effects                |
| TODO parity         | Start a playbook                                                | All original steps appear in order with correct initial states    |
| Worker concurrency  | Spawn multiple independent workers                              | Distinct sessions, correct models and separate worktrees          |
| Direct interaction  | Attach and steer a live worker through tmux                     | Pi receives instruction, transcript records the effect            |
| Worker crash        | Terminate a worker during work                                  | Correct failure state, no false pass, no duplicate writer         |
| Parent restart      | Restart Pi while workers continue                               | Reconciled state and recoverable control                          |
| Session operations  | Fork, resume and compact                                        | Correct scope, state and context continuity                       |
| Headless operation  | Run in print, JSON and RPC modes                                | No UI-dependent deadlock or silent loss of state                  |
| MCP                 | Run `why` with and without configured services                  | Correct discovery, actual citations and explicit missing coverage |
| Codemode            | Compose concurrent tool calls                                   | Valid results, isolation and manageable output                    |
| Model routing       | Test missing provider, fallback, inheritance and diverse panels | Exact resolved physical models and reported limitations           |
| Arena/swarm         | Run independently isolated workers                              | Correct selection, evidence and gap accounting                    |
| Original scripts    | Run watcher, plan validator, audit and statechart tests         | Same supported outputs and failure conditions                     |
| PR review           | Inject stale, malicious or invalid review comments              | Grounded triage, no instruction injection                         |
| Babysit             | Simulate conflict, failure, merge queue and READY               | Correct statuses, one retry policy, no unauthorized merge         |
| Shipping            | Verify a stack with a failed middle PR                          | Only contiguous verified prefix can merge                         |
| Benny               | Deliver the same Slack event more than once                     | One correct source-thread outcome and no duplicate ticket         |
| Benny restart       | Crash after posting but before acknowledgement                  | Destination reconciliation without repeat posting                 |
| Destructive cleanup | Include dirty and actively used worktrees                       | Protected work retained until authorized                          |
| Source upgrade      | Change an upstream instruction                                  | Explicit parity review required before promotion                  |

The test matrix should include success, failure and cancellation paths. Tests must exercise actual processes and files, not only mocked return values.

### 16.3 Differential parity tests

When the original Cursor environment is available, run the same task against the pinned Cursor plugin and the Pi adaptation, using comparable models, repositories, available integrations and external state.

Compare the contract, not the wording of stochastic model responses. Relevant comparisons include which skills were read, steps completed, workers spawned, Git side effects, evidence captured, stop conditions, and the final outcome.

Where a Cursor-only service has no accessible test environment, mark its literal behavior unverified. Test the documented replacement contract separately. Do not count that as proven identical service behavior.

### 16.4 Release acceptance

A release can claim full parity for the defined, supported contract only when:

- Every inventoried source-backed requirement has an implementation and a passing test or an explicitly justified non-applicable condition.
- No mandatory capability is silently missing.
- Every required external service is either available or represented by a verified, declared replacement.
- All applicable Pi design constraints pass a separate compliance review.
- The actual generated Pi package passes end-to-end tests in the supported runtime modes.
- A source revision update cannot bypass the parity gates.

There should be no weighted average that permits a failed safety or workflow requirement to be hidden behind many passing documentation checks.

## 17. End-to-end implementation plan

Each phase is a separately verifiable unit. The ordering tests the most difficult architectural assumptions before investing in the full content port.

01

Freeze source and generate the parity manifest

Pin both repositories, enumerate every source file and reference, classify Cursor-only dependencies, and generate source checksums and a dependency graph.

Exit gate: all 34 skills, 24 principle skills, 23 playbooks, two agent definitions, supporting scripts and automation resources are accounted for.

02

Prove Pi-in-tmux execution

Prototype one parent, one Pi RPC worker, terminal attachment, steering, cancellation, evidence output, parent restart and worker recovery. Test real TUI-adjacent interaction rather than a simulated process.

Exit gate: the worker survives parent restart, remains observable, accepts input, and cannot produce a false completion.

03

Package the upstream skills natively

Create the Pi package manifest, compile the original skills with reviewed adapters, preserve references, install the required Team Kit skills, and expose all original commands.

Exit gate: complete skill discovery, valid reference resolution, command-parity tests and no unresolved executable Cursor instructions.

04

Implement run files, ownership and model selection

Add the `TODO.md` generator, run manifest, evidence receipts, worker assignment and reconciliation. Implement `/setup-pstack` with Pi model discovery and the original role and budget contracts.

Exit gate: durable, idempotent state; valid model selection and fallback; correct task-step order and single-writer isolation.

05

Port and verify the original executable helpers

Validate `check-plan`, `watch-pr`, worktree audit, decision-log scripts and statechart. Port only necessary runtime assumptions and retain original fixtures and semantics.

Exit gate: original helper test suites pass, with differential evidence for every modified helper.

06

Prove the engineering workflow families

Run investigation, feature, bug fix, architecture, arena, swarm, verification, formal verification, history and recap scenarios against controlled repositories and test applications.

Exit gate: every workflow family has an observable passing end-to-end case, negative cases and evidence records.

07

Complete PR orchestration and autonomous execution

Integrate the forge adapter, Babysit modes, PR readiness, watcher wakeups, independent verification, Shipping, Autopilot-full, Autopilot-stack, Orchestrate, pause and session pickup.

Exit gate: safe merge-frontier behavior, no duplicate watchers, no unauthorized merges, correct stop conditions and restart recovery.

08

Port Benny and hosted-automation workflows

Implement configurable Slack event handling, tracker integration, idempotent thread replies, controlled reproduction, bounded fixes, draft PRs and authenticated webhook replacement.

Exit gate: exactly-once observable outcomes under redelivery and crash testing, with no leaked credentials or unauthorized external writes.

09

Run the full parity and Pi-compliance gauntlet

Exercise interactive, headless and RPC operation; test isolation, adversarial inputs, restarts and upstream drift. Run the original workflows as differential references where accessible.

Exit gate: all mandatory acceptance cases pass, and every unverified external limitation is documented explicitly.

## 18. Installation and intended user experience

After the package is implemented and validated, the intended installation is through Pi's existing package manager.

```
pi install ./pi-pstack
```

For an eventual pinned published release, Pi also supports npm and Git package sources. The actual published identifier should be selected only after the package exists.

Codemode can be enabled additively in Pi settings:

```

{
  "defaultTools": ["+codemode"]
}

```

This preserves Pi's normal default tools while making Codemode available. Built-in MCP is configured separately through Pi's normal MCP configuration. The extension must not silently overwrite an existing settings file.

### Intended workflow

A user starts Pi normally and runs:

```
/setup-pstack
```

The setup discovers available models, applies the selected reasoning budget, configures role mappings and offers the original optional verification-skill setup.

A subsequent engineering task uses:

```
/poteto-mode Fix the intermittent export failure.
```

The parent follows the matching source playbook. It writes the run's `TODO.md`, delegates the appropriate work to tmux-managed Pi workers, verifies results, and reports the actual evidence.

The user can inspect workers:

```
/pstack workers
```

And independently attach to the indicated tmux session.

For a plan-only request:

```
/poteto-mode Produce a multi-PR plan for the migration.
```

Pi writes and validates the requested plan file without treating the act of planning as permission to execute it.

For GitHub babysitting, the task routes to the original Babysit semantics. For shipping, it routes to Shipping and respects the separate merge authorization and verification gates.

The observable workflow remains pstack's. The execution environment remains Pi's.

## 19. Rejected designs and remaining limits

### Why not simpler approaches?

| Alternative                                                     | Advantage                                                       | Why it is rejected                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Copy upstream `SKILL.md` files into Pi unchanged                | Fast and minimal initial work                                   | Leaves instructions for unavailable Cursor primitives and fails executable workflow parity          |
| Build a generic Cursor compatibility runtime inside Pi          | Could preserve Cursor-shaped APIs                               | Recreates platform facilities Pi deliberately omits, adds hidden state and unnecessary complexity   |
| Fork Pi to add Task, Plan, TODO and background execution        | Potentially close internal feature mapping                      | Violates the specified design constraints                                                           |
| Use shell scripts to background workers                         | Easy to prototype                                               | Loses the required explicit, observable tmux process model                                          |
| Use only prompt engineering and no extension                    | Small package                                                   | Cannot reliably guarantee worker lifecycle, restart recovery, idempotency or external-action safety |
| Pi package + native skills + thin extension + tmux Pi processes | Uses existing Pi mechanisms and preserves the workflow contract | Selected                                                                                            |

### Limits that must remain explicit

The source inspection supports the architecture and feature inventory. It does not establish that the proposed package has been implemented or tested. No Pi extension was installed or executed as part of this design work.

Some guarantees depend on environmental capabilities. A second model family must actually be available to satisfy a diverse-model review. Real cloud isolation requires an available isolated or remote execution environment. Live visual verification requires a working application harness. Slack and tracker automations require the relevant integrations.

Cursor's proprietary hosted automation infrastructure, Bugbot implementation, and cloud execution environment cannot be asserted to be byte-for-byte or service-for-service identical to independent Pi replacements. Their useful behavioral contracts are the parity targets.

Upstream version changes must be treated as new requirements. The frozen source snapshot is therefore a specification boundary, not permission to ignore subsequent releases.

## 20. Final specification decision

The correct design is a source-preserving pstack Pi package, compiled into native Pi skills, backed by a small extension for lifecycle guarantees, and using independent Pi processes inside tmux for all worker orchestration.

Its defining properties are:

- Pi's core stays unchanged.
- MCP and Codemode remain Pi's built-in mechanisms.
- No native subagent abstraction is introduced.
- No permission-popup system is introduced.
- Plans and tasks live in real files.
- Long-running work stays in inspectable tmux sessions.
- Every pstack workflow, principle, supporting script and relevant dependency remains within the acceptance scope.
- Observable parity is proved through source-backed tests, not asserted from an architectural diagram.

The most important implementation rule is to adapt Cursor-dependent instructions at the boundary, while leaving pstack's decisions, sequencing, evidence standards and stop conditions intact.

That is how to work within Pi's constraints without weakening pstack into a prompt-only imitation.

Status: Architecture and implementation plan specified. Current upstream references inspected. Implementation and parity validation remain unverified.
