# About the S50 architecture

S50 is one deterministic coordinator behind three surfaces that share one argv grammar:

| Surface | Who types it | Entry |
| --- | --- | --- |
| `s50 ...` shell command | the human | `src/cli/main.ts` |
| `/s50 ...` Pi command | the human | `pi.registerCommand('s50')` in `src/index.ts` |
| `s50` Pi tool, `{ argv: [...] }` | the model | `pi.registerTool({ name: 's50' })` in `src/index.ts` |

All three call `runCli(argv, context)` in `src/cli/commands.ts`. The only asymmetry is deliberate. The model surface asks the user through `ctx.ui.confirm` before it applies a human-only command (`confirm_understanding`, `confirm_seams`, `grant_authorization`, `complete_user_workflow`). Without a UI it refuses and names the `/s50 apply ...` the user must type.

The `s50` skill (`skills/s50/SKILL.md`) is thin. It tells the agent to read state through the tool, act on `nextAction`, load an installed eligible skill when the coordinator says so, and stop at gates. Workflow detail lives in `skills/s50/references/`.

## The coordinator

The coordinator is four modules in `src/orchestrator/`. `command.ts` holds the `Command`, `Outcome`, and `NextAction` types and the small state helpers. `phases.ts` holds the guard table and `advance`. `handlers.ts` holds one pure handler per command. `coordinator.ts` maps each command kind to its handler and exposes three pure functions:

- `startRun(input, registry, clock)` builds a `RunState`.
- `apply(state, command, clock)` returns `{ kind: 'ok', state, decisions }` or `{ kind: 'rejected', reason, gate }`.
- `nextAction(state)` returns the next automatic action or the human gate.

`Command` is a discriminated union of 29 kinds. Every phase change goes through `advance`, which checks the edge table in `src/orchestrator/transitions.ts` and then the target phase's entry in the `GUARDS` table. Failures route back along table edges to the owning phase (for example `REVIEW -> IMPLEMENT`, `VERIFY -> DESIGN`, `REVERIFY_STALE -> IMPLEMENT`), so a failed check never restarts the run.

Re-applying a command whose effect already holds returns `ok` with the same state and no decision. Two commands log on every call and change no state: an allowed `invoke_skill` and `record_test`. They are records of an event, not state.

## Data shape

The data shape lives in `src/domain/` and was written before any logic:

- `state.ts`: the 20 phases, five modes, the `Gate` union, and `RunStatus` (`active`, `blocked` with a gate, `inconclusive` with what is missing, `pr_ready` with a revision).
- `run.ts`: `Run` (schema version 2) and `RunState` (`run`, `graph`, `evidence`, `findings`).
- `graph.ts`: `GraphNode` with dependencies, owner, write set, schemas, migrations, defined and consumed interfaces, runtime ownership, expected behavior, and verification method.
- `evidence.ts`: `EvidenceRecord` with states `MEASURED`, `INFERRED`, `UNKNOWN`, `INCONCLUSIVE`, `STALE`, `FAILED`.
- `findings.ts`: `Finding` with severity, trigger, consequence, evidence, revision, owner, status, reviewer, and the web-guideline digest.
- `registry.ts`: `RegistrySnapshot` and `LockedSkill`.

## Persistence

`src/orchestrator/persistence.ts` is the only module that writes `.s50/`. Each file has one owner and one shape:

| File | Shape | Write mode |
| --- | --- | --- |
| `registry.lock.json` | `RegistrySnapshot` | replaced by `registry refresh` |
| `run.json` | `Run` | replaced atomically |
| `graph.json` | `Graph` | replaced atomically |
| `evidence.jsonl` | `EvidenceRecord` per line | append-only |
| `findings.jsonl` | `Finding` per status change | append-only |
| `decisions.jsonl` | `DecisionLog` per line | append-only |
| `.gitignore` | `*` | created once |

The self-ignoring `.gitignore` keeps run data out of Git without editing the project's ignore rules. Delete it to commit an audit trail.

`loadState` validates every file at the boundary through the decoders in `src/orchestrator/schema.ts` and migrates schema version 1 runs to version 2.

## Design alternatives

| | Chosen: single-writer reducer | Rejected: event-sourced fold |
| --- | --- | --- |
| State on disk | snapshot files plus append-only histories | every event, state rebuilt by replay |
| Resume cost | read four files | replay the whole log |
| Schema migration | one migration per snapshot version | every historical event shape forever |
| Ownership | one module per file | one log every module writes |
| Testability | pure `apply` on a value | pure fold, plus replay fixtures |
| Reader load | read `run.json` to see the run | run the fold to see the run |

The event-sourced fold buys a full replay, but the append-only evidence, findings, and decision logs already keep the history that matters. It costs a migration for every event shape ever written. The reducer won.

A second rejected shape was putting the workflow in skill prose. Prose cannot enforce a gate, so the coordinator owns every rule and the skill only routes.

## Concurrency

`src/scheduler/` decides what may run at once. `readyFrontier` lists nodes whose dependencies all passed. `conflict(a, b)` returns the reason two nodes cannot run together: overlapping write sets (glob-aware), a shared schema, a shared migration, one defining an interface the other consumes, or shared runtime ownership. `schedule` returns a concurrent batch only when the host reports both `independentAgents` and `isolatedWorktrees`. Each concurrent node gets its own workspace under `.s50/worktrees/<node-id>`. Otherwise it returns one node at a time. S50 never labels sequential work as parallel.

The Pi host reports `independentAgents: false` by default (`src/adapters/agents.ts`). Pi has no built-in subagent primitive, so S50 serializes unless the caller passes `--capabilities` describing a host that has one.
