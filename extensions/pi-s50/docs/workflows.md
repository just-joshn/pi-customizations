# S50 workflows

This page walks each route through the phase table in `src/orchestrator/transitions.ts`. Command JSON shapes are in `skills/s50/references/`.

Each rule is tagged with where it comes from:

- **Upstream** is a fact inherited from an external skill contract, read from the `SKILL.md` revision pinned in `registry/skill-sources.json`.
- **S50** is a policy choice made here, enforced by the coordinator.
- **Host** depends on what the harness can do. The README lists those capabilities.

## Start

`s50 feature|bug|frontend|issue|survey <text>` creates the run and walks `START -> PREFLIGHT -> CLASSIFY` into the first working phase.

**S50.** Start refuses when the registry lock is missing, was rejected by its last refresh, or does not verify. Preflight then records one decision line and stores the same facts in `run.preflight`: repository root and `origin` remote, revision, dirty state, languages, package manager, test and build commands, instruction files (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`), glossary files (`GLOSSARY.md`, `GLOSSARY-MAP.md`), the ADR count under `docs/adr/`, React detection, installed skills, the registry snapshot time, and the consumer route.

Preflight turns these into risks: a dirty tree, an INCONCLUSIVE consumer route, no test command, and an installed skill whose content hash differs from the lock. It blocks only on a real dependency:

- **S50.** A skill the route needs that Pi cannot find becomes a `missing_skill` gate with the `npx skills add <source> --skill <name>` action. S50 does not substitute a weaker process.
- **Upstream.** `triage` reads `docs/agents/issue-tracker.md`, which `setup-matt-pocock-skills` writes. Only an `issue` run without that file blocks on `/skill:setup-matt-pocock-skills`. No other route requires it.

## Classify

| Subcommand | Mode | First phase |
| --- | --- | --- |
| `feature` | `feature` | `CLARIFY` |
| `frontend` | `frontend` | `CLARIFY` |
| `bug` | `bug` | `DIAGNOSE` |
| `issue` | `external_issue` | `EXPLICIT_TRIAGE` |
| `survey` | `architecture_survey` | `EXPLICIT_ARCH_REVIEW` |

`EXPLICIT_TRIAGE` and `EXPLICIT_ARCH_REVIEW` enter blocked on a `user_workflow` gate (`/skill:triage`, `/skill:improve-codebase-architecture`). The run resumes after the user applies `complete_user_workflow`.

## Invocation policy

**Upstream.** A skill whose frontmatter has `disable-model-invocation: true` is user-only. At the pinned revisions these are `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `setup-matt-pocock-skills`, `handoff`, `triage`, and `teach`.

**S50.** `invoke_skill` on a user-only skill is rejected with the exact `user_workflow` gate, and S50 never imitates the workflow. The skill must also be in the run's locked registry and installed.

## Clarify

**Upstream (`grilling`).** Decisions form a tree. Each round asks the whole frontier, numbered, each with a recommended answer. A question that depends on another open question waits for a later round. Facts are found by the agent, never asked. The work waits for the user to confirm a shared understanding.

**S50.** `ask_decisions` blocks the run on a `decisions` gate and refuses a question whose `dependsOn` names an undecided one. `answer_decisions` clears the gate once every question is answered. A question put to the user takes only a `decidedBy: user` answer, and a fact cannot replace a user's decision; Pi asks the user before the model may record a user answer. An empty round asks for the shared-understanding confirmation, and only `confirm_understanding` records it. `CLARIFY -> DOMAIN` is refused until it holds.

## Domain

**Upstream (`domain-modeling`).** Terms go in `GLOSSARY.md`, or `GLOSSARY-MAP.md` across contexts, never implementation detail. An ADR is offered only when a decision is hard to reverse, surprising without context, and the result of a real trade-off.

**S50.** The run records `domain.model_change` as yes or no. With `no`, the existing glossary is read and `domain-modeling` is not invoked. With `yes`, `domain-modeling` is routed and `DOMAIN -> ARCHITECT` needs recorded terms. S50 keeps its own run decisions in `.s50/decisions.jsonl` and never writes `docs/adr/`. S50 does not check what the agent writes into the glossary or whether an ADR meets the upstream rule; the agent follows `domain-modeling` for that.

## Architect

**Upstream (`codebase-design`).** Vocabulary for module, interface, depth, seam, adapter, leverage, and locality.

**S50.** `propose_designs` needs at least two candidates, and `choose_design` needs a reason. `IMPLEMENT -> ARCHITECT` and `REVIEW -> ARCHITECT` are the scrap edges for repeated structural workarounds. S50 cannot judge whether two designs differ structurally; the reviewer does.

## Prototype

**Upstream (`prototype`).** A prototype answers one question, is throwaway, and is committed to a throwaway branch with a context pointer on the implementation issue. The verdict is captured too.

**S50.** An `architecture.uncertainty` decision routes ARCHITECT to PROTOTYPE and blocks the move to DESIGN or CONFIRM_TDD_SEAMS until a prototype answers that exact question. `record_prototype` runs only in PROTOTYPE and needs the question, the verdict, and the branch. It writes `MEASURED` evidence with method `prototype` whose artifact names the branch and the optional issue pointer.

## Design (web UI)

**Upstream (`frontend-design`).** Intentional visual direction for web UI.

**S50.** A run is web UI when its mode is `frontend` or its consumer is a browser or Electron app. ARCHITECT then routes to DESIGN, which invokes `frontend-design`, and `vercel-react-best-practices` only when a constraint names React or Next.js or the repository depends on `react` or `next`. `DESIGN -> CONFIRM_TDD_SEAMS` is refused until a `design.<item>` decision exists for each of subject, audience, primary job, visual direction, information hierarchy, layout, typography, interaction model, responsive behavior, loading state, empty state, error state, and accessibility.

## TDD seams

**Upstream (`tdd`).** Tests live only at seams confirmed with the user. One failing test, then only enough code to pass it. Refactoring is not part of the loop; it belongs to review.

**S50.** `propose_seams` needs each seam's description, what it catches, and what it misses, and blocks on `seam_confirmation`. A confirmed seam cannot be rewritten under the same id. `record_test` at an unconfirmed seam is rejected. A test's GREEN record is refused until the same test has a RED record, and a test that is GREEN at the current revision cannot be recorded RED. `CONFIRM_TDD_SEAMS -> BUILD_GRAPH` needs at least one confirmed seam.

## The diagnostic-test exception (bug)

**Upstream (`diagnosing-bugs`).** Build a red-capable feedback loop before any hypothesis. If none can be built, stop and say what access or artifact is missing.

**S50.** In `DIAGNOSE`, `record_diagnostic` accepts a new loop (failing test, HTTP, CLI fixture, browser, trace replay, throwaway program, fuzz, bisect, differential, or human-assisted) before any seam is confirmed. It is the only test-like artifact allowed ahead of seam confirmation, and it is temporary:

1. `record_root_cause` needs a red loop.
2. After `CONFIRM_TDD_SEAMS` confirms the permanent seam, `promote_diagnostic` moves the loop there. Promotion to an unconfirmed seam is refused with a `seam_confirmation` gate.
3. The loop lists the temporary instrumentation added for it. After the fix, the agent records the original reproducer green with the instrumentation cleared.
4. PR_READY needs a root cause, a promoted loop, every loop green, and no instrumentation left.

With no possible loop, `declare_inconclusive` sets the run INCONCLUSIVE with what is missing, and the run cannot advance until a new loop is recorded.

## Graph

**S50.** `build_graph` rejects node ids that are not plain path segments (they name worktree directories and Git branches), nodes whose objective is a layer name (`database`, `backend`, `frontend`, `tests`, `api`, `ui`, `schema`, `migration`), duplicate ids, unknown dependencies, cycles, empty write sets, and nodes without an owner or expected behavior. Concurrency rules are in [architecture.md](architecture.md#concurrency).

## Integrate

**S50.** The first `integrate_node` names the integration owner, and every later one must name the same owner. An owner of a graph node may not integrate, so workers do not merge into one another. Integration binds the new revision, stales evidence whose paths changed, and stales evidence that depends on `node:<id>` or on an interface the node defines. Worker evidence from before integration therefore does not prove the integrated revision.

## Review

See [verification.md](verification.md#review).

## Freeze and PR_READY

`freeze_revision` pins the current revision. `REVERIFY_STALE -> PR_READY` passes only when `prReadyBlockers` returns no blocker. PR_READY stays live: a revision change, a new finding, or a failed measurement moves the run back to `REVERIFY_STALE`.

## Authorization

**S50.** `request_authorization` is refused while the run is INCONCLUSIVE, and otherwise blocks for force-push, merge, deploy, destructive data deletion, public messages, customer communication, sensitive-data disclosure, and other irreversible actions. Only `grant_authorization` with the exact action and scope clears it, and Pi asks the user before the model may apply it. A broad autonomy grant does not clear it.

**Host.** Inside Pi, a `tool_call` handler recognizes force-push, PR merge, deploy, destructive deletion, publish, and public-message bash commands during a run. With a UI it asks the user and records the request and the grant. Without a UI it blocks the command.
