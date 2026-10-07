# About the S50 architecture

S50 is one deterministic coordinator behind three surfaces that share one argv grammar:

| Surface | Who types it | Entry |
| --- | --- | --- |
| `s50 ...` in a shell | the human | `src/cli/main.ts` |
| `/s50 ...` in Pi | the human | `pi.registerCommand('s50')` in `src/index.ts` |
| the `s50` tool, `{ argv: [...] }` | the model | `pi.registerTool({ name: 's50' })` in `src/index.ts` |

All three call `runCli(argv, context)` in `src/cli/commands.ts`. The context is the only thing that differs, and it carries host facts, not grammar:

- The shell asks Pi's `DefaultResourceLoader` which skills a session in that directory would load.
- Pi asks its session (`pi.getCommands()`) which skills are loaded, hashes each SKILL.md, and reports independent agents when a `subagent` or `Task` tool is registered.
- The tool passes the turn's abort signal to every Git call and fetch.

The model surface adds guards on top. Before it applies a command that records a user decision, or a start command that overrides host facts with `--capabilities` or `--installed`, it asks the user through `ctx.ui.confirm`; without a UI it refuses. A `tool_call` handler stops gated bash commands during a run in the same way. It also blocks, with or without a run, any bash command that runs the `s50` CLI or its `src/cli/main.ts` entry, redirects into `.s50/`, or names `.s50/` from a program that is not a known reader (`cat`, `jq`, `grep`, and the like), plus every `write` or `edit` call on a path under `.s50/`. Otherwise the model could record a user decision without the dialog. Tools other than bash, `write`, and `edit` are not inspected.

The `s50` skill (`skills/s50/SKILL.md`) is thin. It tells the agent to read state through the tool, act on `nextAction`, load an installed eligible skill when the coordinator says so, and stop at gates. Workflow detail lives in `skills/s50/references/`, and a test decodes every command example in those references.

## The coordinator

The coordinator is a set of modules in `src/orchestrator/`:

- `command.ts` holds the `Command`, `Outcome`, and `NextAction` types and small state helpers.
- `transitions.ts` holds the legal phase edges.
- `phases.ts` holds the guard for entering each phase, and `advance`.
- `handlers.ts` holds one pure handler per command.
- `facts.ts` derives routing facts from the run.
- `coordinator.ts` maps each command kind to its handler and exposes `startRun`, `apply`, `applyPreflight`, and `nextAction`.
- `schema.ts` and `decode.ts` validate everything that crosses a boundary.
- `persistence.ts` reads and writes `.s50/`.
- `status.ts` renders status, and `routes.ts` holds the classification and failure-owner tables.

`apply(state, command, clock)` decodes the command again after redacting its free text, so no caller can store a secret there or skip validation. It returns `{ kind: 'ok', state, decisions }` or `{ kind: 'rejected', reason, gate }`. After every change it recomputes `run.blockers` from the PR_READY predicate and moves a `PR_READY` run back to `REVERIFY_STALE` when a blocker reappears.

Every command re-derives the stored blockers and the PR_READY status after loading, so a migrated or older run cannot keep a stale PR_READY. Every phase change goes through `advance`, which checks the edge table and then the target phase's guard in the `GUARDS` table. A failed check uses `route_failure`, which moves the run along a legal edge to the phase that owns that check (`FAILURE_OWNERS` in `routes.ts`), so a failure never restarts the run.

Re-applying a command whose effect already holds returns `ok` with the same state and no decision. `invoke_skill` records each routed skill once per phase visit, so `nextAction` moves on to the phase's work after the skill is loaded, and leaving the phase clears the record.

## Data shape

The data shape lives in `src/domain/`:

- `state.ts`: the 20 phases, the five modes, the `Gate` union, and `RunStatus` (`active`, `blocked` with a gate, `inconclusive` with what is missing, `pr_ready` with a revision).
- `run.ts`: `Run` (schema version 2), `RunState` (`run`, `graph`, `evidence`, `findings`), `Preflight`, `DiagnosticLoop`, and `InstalledSkill`.
- `graph.ts`: `GraphNode` with dependencies, owner, write set, schemas, migrations, defined and consumed interfaces, runtime ownership, expected behavior, and verification method.
- `evidence.ts`: `EvidenceRecord` with states `MEASURED`, `INFERRED`, `UNKNOWN`, `INCONCLUSIVE`, `STALE`, and `FAILED`.
- `findings.ts`: `Finding` with severity, trigger, consequence, evidence, revision, owner, status, reviewer, and the guideline digest.
- `registry.ts`: `RegistrySnapshot`, `LockedSkill`, and `RegistryLock` (approved or rejected).

## Persistence

| File | Shape | Write mode |
| --- | --- | --- |
| `registry.lock.json` | `RegistryLock`, schema version 1 | replaced by `registry refresh` |
| `run.json` | `Run`, schema version 2 | replaced atomically |
| `graph.json` | `Graph`, schema version 1 | replaced atomically |
| `evidence.jsonl` | one `EvidenceRecord` per line, each with `schemaVersion` | append-only |
| `findings.jsonl` | one `Finding` per status change, each with `schemaVersion` | append-only |
| `decisions.jsonl` | one `DecisionLog` per line, each with `schemaVersion` | append-only |
| `.gitignore` | `*` | written once, when S50 creates `.s50/` |
| `worktrees/<node>/` | a Git worktree per node on a parallel host | created by `start_nodes` |

`loadState` validates `run.json`, `graph.json`, `evidence.jsonl`, and `findings.jsonl`, and migrates a version 1 run, which kept the phase in `status`, to version 2 through the `MIGRATIONS` table. `readLock` and `readDecisions` validate the lock and the decision log. Every JSONL line must carry `schemaVersion` 1, and a lock file must carry `schemaVersion` 1; anything else is refused.

Inside one Pi process, every surface runs under `withFileMutationQueue` on the `.s50/` path, and the tool runs with `executionMode: 'sequential'`, so sibling tool calls cannot interleave a read-modify-write of `.s50/`.

## Design alternatives

| | Chosen: single-writer reducer | Rejected: event-sourced fold |
| --- | --- | --- |
| State on disk | snapshot files plus append-only histories | every event, state rebuilt by replay |
| Resume cost | read four files | replay the whole log |
| Schema migration | one step per snapshot version | every historical event shape forever |
| Ownership | one module writes `.s50/` | one log every module writes |
| Reader load | read `run.json` to see the run | run the fold to see the run |

The event-sourced fold buys a full replay, but the append-only evidence, findings, and decision logs already keep the history that matters, and the fold costs a migration for every event shape ever written. The reducer won.

A second rejected shape put the workflow in skill prose. Prose cannot enforce a gate, so the coordinator owns every rule and the skill only routes.

## Concurrency

`src/scheduler/` decides what may run at once. `readyFrontier` lists pending or failed nodes whose dependencies all passed or integrated. `conflict(a, b)` returns why two nodes cannot run together: overlapping write sets, a shared schema, a shared migration, one defining an interface the other consumes, or shared runtime ownership. `start_nodes` checks the nodes it starts against each other and against nodes still running. It allows more than one running node only when the host reports both `independentAgents` and `isolatedWorktrees`. On such a host every node gets a Git worktree at `.s50/worktrees/<node>` on branch `s50/<run>/<node>` from its first start, so a later node never shares a running node's checkout. A serial host proposes no new node while one runs. Stale worktree entries are pruned first, and a worktree on another branch is refused, not reused.

Inside Pi, `independentAgents` follows the registered tools, and `isolatedWorktrees` comes only from `--capabilities`. A Pi session with no declared worktree isolation therefore runs nodes one at a time.
