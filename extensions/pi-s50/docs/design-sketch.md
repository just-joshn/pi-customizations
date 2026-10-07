# S50 design sketch (implementation contract)

This file is the contract for implementers. Do not deviate silently. If the sketch is wrong, stop and report.

Existing, already written, do not change shape without reporting:
- `src/domain/{state,registry,graph,evidence,findings,run}.ts` hold the data shape.
- `src/orchestrator/transitions.ts` holds the legal phase edges.
- `test/fixtures/leaderboard.2026-10-07.json` is the captured skills.sh all-time top 60 (ranks 1..60).
- `test/fixtures/skill-sources.2026-10-07.json` maps each S50 dependency to repository, commit, path, sha256 content hash, invocation policy (`disable-model-invocation: true` means `user`).

Language: TypeScript run directly by Node 24 type stripping (`node src/cli/main.ts`). Only erasable syntax. Imports use `.ts` extensions. No runtime third-party dependencies. `typebox` is allowed only in `src/index.ts` for the Pi tool schema. Tests use vitest. Tsconfig strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`. No `as` casts except after validation; no `any`; no `console.log` in src (CLI writes through `process.stdout.write`). Comments only for non-obvious why.

## Chosen architecture: single-writer reducer behind one coordinator

Public surface (the deep module):

```ts
// src/orchestrator/coordinator.ts
export type Command = /* discriminated union, see below */;
export type Outcome =
  | { kind: 'ok'; state: RunState; decisions: readonly DecisionLog[] }
  | { kind: 'rejected'; reason: string; gate: Gate | null };
export function apply(state: RunState, command: Command, clock: Clock): Outcome; // pure
export function nextAction(state: RunState): NextAction; // pure
export function startRun(input: StartInput, registry: RegistrySnapshot, clock: Clock): RunState; // pure
```

`Clock = { now(): string; id(prefix: string): string }`; deterministic in tests.

`DecisionLog = { at: string; phase: Phase; command: Command['kind']; summary: string }` appended to `decisions.jsonl`.

Idempotency: applying a command whose effect is already present returns `ok` with the same state and no new decision (e.g. confirming an already-confirmed seam, recording an identical evidence record, `resume`).

Rejected alternative (record in docs/architecture.md): event-sourced fold of every event into state. Rejected because replay plus per-event schema migration makes resume and migration costlier, and the required `.s50/` file split already gives each artifact one owner.

### Commands (discriminated on `kind`)

```
advance { to: Phase }                       // explicit transition; guarded
invoke_skill { skill: string }              // policy check; user-only => rejected + user_workflow gate
complete_user_workflow { skill }            // user did /skill:<name>; clears gate
answer_decisions { decisions: Decision[] }  // grilling round answers
confirm_understanding {}                    // shared-understanding confirmation
record_domain { terms, invariants, scenarios }
propose_designs { candidates: DesignCandidate[] }   // >= 2 required
choose_design { id, reason, interfaces, seams, ownership }
record_prototype { question, verdict, branch, issuePointer }
propose_seams { seams: Seam[] }
confirm_seams { ids: string[] }             // user confirmation
record_test { seam: string; kind: 'tdd' }   // rejected unless seam confirmed
record_diagnostic { loop: DiagnosticLoop }  // allowed in DIAGNOSE before any seam confirmation
record_root_cause { cause }                 // requires a red diagnostic loop
promote_diagnostic { loopId, seamId }       // seam must be confirmed
build_graph { nodes: GraphNode[] }          // rejects horizontal layer names, unknown deps, cycles
start_nodes { ids: string[] }               // all must be in ready frontier and pairwise concurrency-safe and host supports workers when >1
complete_node { id, passed: boolean }
integrate_node { id, revision, changedPaths: string[] }  // single integration owner "integrator"; stales evidence
record_evidence { evidence: Omit<EvidenceRecord,'id'|'recordedAt'|'supersedes'|'revision'> } // bound to run.currentRevision; redacted
revision_changed { revision, changedPaths: string[] }    // stales matching evidence
record_finding { finding: Omit<Finding,'id'|'status'|'revision'> } // reviewer cannot patch: revision bound to current
resolve_finding { id, resolution: 'resolved'|'dismissed' }
request_authorization { action: AuthorizationAction, scope } // always blocks with authorization gate
grant_authorization { action, scope }       // only exact action+scope clears
freeze_revision {}                          // sets frozenRevision = currentRevision
```

## Module map (each file owns one body of knowledge)

- `src/registry/fetch.ts` parse skills.sh HTML (`initialSkills` JSON array escaped in the Next.js flight payload, view `all-time`) into `LeaderboardEntry[]`; `fetchLeaderboard(fetchFn)` live (optional, never in unit tests).
- `src/registry/lock.ts` `buildSnapshot({ leaderboard, sources, required, snapshotTime, source })` => `{kind:'ok', snapshot} | {kind:'ineligible', skills: string[]}` fails closed when a required skill rank > 50 or absent. `S50_DEPENDENCIES` list of the 18 names lives here. Read/write `registry.lock.json`.
- `src/registry/validate.ts` parse unknown JSON to RegistrySnapshot (boundary), `verifySnapshot(snapshot)` checks every skill rank<=50 and matches leaderboard entry.
- `src/policy/invocation.ts` `canModelInvoke(registry, skill)` => `{kind:'allowed'} | {kind:'user_only', action: '/skill:<name>'} | {kind:'not_in_registry'} | {kind:'not_installed', install: 'npx skills add <source> --skill <name>'}`. Route-specific skill selection table: `ROUTE_SKILLS: Record<Phase, ...>` (CLARIFY grilling, DOMAIN domain-modeling only if model change, ARCHITECT codebase-design, PROTOTYPE prototype, DESIGN frontend-design (+vercel-react-best-practices when stack is react/next), CONFIRM_TDD_SEAMS tdd, DIAGNOSE diagnosing-bugs, EXPLICIT_TRIAGE triage(user), EXPLICIT_ARCH_REVIEW improve-codebase-architecture(user), REVIEW web-design-guidelines for web UI, VERIFY agent-browser for browser/electron).
- `src/policy/authorization.ts` gated actions table; `requiresAuthorization(action)`; grants are exact action+scope.
- `src/policy/completion.ts` `requiredEvidence(state)` one claim per acceptance criterion; `prReadyBlockers(state)` returns string list; empty == PR_READY allowed. Only MEASURED or INFERRED? => only `MEASURED` satisfies, plus revision === frozenRevision === currentRevision; no open findings of any severity; all graph nodes integrated; no diagnostic loop still `red`; bug runs need root cause + promoted diagnostic. UNKNOWN, INCONCLUSIVE, STALE, FAILED, INFERRED never satisfy.
- `src/scheduler/frontier.ts` `readyFrontier(graph)` pending nodes whose deps are all passed or integrated; dependency blocking.
- `src/scheduler/conflicts.ts` `conflict(a,b)` => null | reason: overlapping write set (glob-prefix aware), same schema, same migration, interface defined by one consumed by other, shared runtime ownership.
- `src/scheduler/ownership.ts` `schedule(graph, capabilities)` => batches: concurrent only when `capabilities.independentAgents && capabilities.isolatedWorktrees` and pairwise conflict-free; otherwise serialize one at a time. Each concurrent node gets workspace `.s50/worktrees/<node-id>`.
- `src/evidence/store.ts` append-only JSONL read/write for evidence, findings, decisions; latest record per claim wins; history retained.
- `src/evidence/invalidation.ts` `matches(glob, path)` (support `**`, `*`), `invalidate(evidence, changedPaths, revision)` returns new STALE records superseding affected current records; unrelated untouched.
- `src/evidence/verification.ts` `routeConsumer(kind, capabilities)` => `{kind:'agent_browser'} | {kind:'drive_executable'} | {kind:'protocol_request'} | {kind:'public_api'} | {kind:'native_automation'} | {kind:'inconclusive', missing}`; browser/electron without driver => inconclusive; native without automation => inconclusive. `redact(text)` replaces bearer tokens, `Authorization:` headers, `sk-...`, `ghp_...`, `xox[bp]-...`, AWS `AKIA...`, `password=...`, JWT-shaped values, PEM private keys with `<REDACTED>`.
- `src/review/reviewer.ts` `REVIEW_DIMENSIONS` (12 from spec) + web UI extras; `reviewAssurance(capabilities)` => `{kind:'independent'}` or `{kind:'reduced', reason:'same-agent read-only review; no independent agents'}`; never label self review independent.
- `src/review/findings.ts` finding creation/resolution helpers; `captureGuidelines(content, skillLock, revision)` => sha256 digest record attached to findings.
- `src/adapters/skills.ts` `SkillRuntime` interface `{ run(skill, input): Promise<SkillResult> }` and `FakeSkillRuntime` scripted deterministic.
- `src/adapters/git.ts` `revision(cwd)`, `changedPaths(cwd, from, to)`, `isDirty`, `createBranch` via `execFile('git')`.
- `src/adapters/shell.ts` `runCommand(cmd,args,cwd)` => {stdout, stderr, exitCode}.
- `src/adapters/agents.ts` host capability detection object (input, not probing): Pi host => independentAgents false unless caller says so.
- `src/adapters/browser.ts` `agentBrowserAvailable()` checks `agent-browser` on PATH.
- `src/orchestrator/routes.ts` `classify(mode)` => first phase after CLASSIFY; `failureOwner(check)` table mapping failing check kind to owning phase.
- `src/orchestrator/coordinator.ts` as above, plus `preflight(repoFacts)` gate selection: triage needs `docs/agents/issue-tracker.md` else blocks with user_workflow `setup-matt-pocock-skills`; missing installed skill => `missing_skill` gate with install action.
- `src/orchestrator/persistence.ts` (in evidence/store or here) `.s50/` read/write: `registry.lock.json`, `run.json`, `graph.json`, `evidence.jsonl`, `findings.jsonl`, `decisions.jsonl`; `migrate(json)` schema 1 => 2 (v1 had `status: string` phase and no `diagnostics`).
- `src/status.ts` -> put in `src/orchestrator/status.ts`: `renderStatus(state)` compact lines: objective, phase, revision, blockers, open findings, ready nodes, running nodes, stale count, next automatic action, next human gate.
- `src/cli/main.ts` and `src/cli/commands.ts`: `s50 feature|bug|frontend <text> [--consumer kind:path] [--criteria a;b]`, `status`, `verify`, `resume`, `explain`, `registry refresh [--from <file>]|show|verify`, plus `s50 apply '<command json>'` for adapters. All read/write `.s50/` in cwd. Exit code 0 ok, 2 rejected/blocked, 1 error.
- `src/index.ts` Pi extension: registers command `s50` (subcommands feature, bug, frontend, verify, status, resume, explain, registry) and model tool `s50` that calls the same coordinator; skill dir `skills/s50` declared in package.json `pi.skills`.
