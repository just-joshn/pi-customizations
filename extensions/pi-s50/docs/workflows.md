# S50 workflows

This page describes each route through the phase table in `src/orchestrator/transitions.ts`. Command JSON shapes are in `skills/s50/references/`.

Each rule below is tagged with where it comes from:

- **Upstream** is a fact inherited from an external skill contract, quoted from the locked `SKILL.md` revision in `registry/skill-sources.json`.
- **S50** is a policy choice made here.
- **Host** depends on what the harness can do.

## Start

`s50 feature|bug|frontend <text>` creates the run and walks `START -> PREFLIGHT -> CLASSIFY` and into the first working phase.

Preflight records one decision line with the revision, dirty state, package manager, instruction files (`AGENTS.md`, `CLAUDE.md`), glossary files (`GLOSSARY.md`, `GLOSSARY-MAP.md`), ADR count under `docs/adr/`, installed skills, and the registry snapshot time. A dirty tree becomes a run risk. Preflight blocks only on a real dependency:

- **S50.** A missing installed skill that the route needs becomes a `missing_skill` gate with the `npx skills add <source> --skill <name>` action. S50 does not substitute a weaker process.
- **Upstream.** `triage` reads `docs/agents/issue-tracker.md`, which `setup-matt-pocock-skills` writes. Only an external-issue run without that file blocks on `/skill:setup-matt-pocock-skills`. No other route requires it.

## Classify

| Mode | First phase |
| --- | --- |
| `feature` | `CLARIFY` |
| `frontend` | `CLARIFY` |
| `bug` | `DIAGNOSE` |
| `external_issue` | `EXPLICIT_TRIAGE` |
| `architecture_survey` | `EXPLICIT_ARCH_REVIEW` |

`EXPLICIT_TRIAGE` and `EXPLICIT_ARCH_REVIEW` enter blocked on a `user_workflow` gate (`/skill:triage`, `/skill:improve-codebase-architecture`). The run resumes after `complete_user_workflow`.

## Invocation policy

**Upstream.** A skill whose frontmatter has `disable-model-invocation: true` is user-only. At the locked revision these are `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `setup-matt-pocock-skills`, `handoff`, `triage`, and `teach`.

**S50.** `invoke_skill` on a user-only skill is rejected with the exact `user_workflow` gate. S50 never imitates the workflow internally. The skill must also be in the run's locked registry and installed.

## Clarify

**Upstream (`grilling`).** Decisions form a tree. Each round asks the whole unblocked frontier, numbered, each with a recommended answer. Facts are found by the agent, never asked. Implementation waits for a shared-understanding confirmation.

**S50.** `answer_decisions` records the round. `confirm_understanding` is human-only. `CLARIFY -> DOMAIN` is refused until it holds.

## Domain

**Upstream (`domain-modeling`).** Terms go in `GLOSSARY.md` (or `GLOSSARY-MAP.md` across contexts), never implementation detail. An ADR is offered only when a decision is hard to reverse, surprising without context, and the result of a real trade-off.

**S50.** `domain-modeling` is routed only when the run has no recorded terms yet. An existing glossary is consumed without invoking it. S50's own run decisions stay in `.s50/decisions.jsonl`, never in `docs/adr/`.

## Architect

**Upstream (`codebase-design`).** Vocabulary: module, interface, depth, seam, adapter, leverage, locality.

**S50.** `propose_designs` needs at least two candidates. `choose_design` records the choice and the reason. `IMPLEMENT -> ARCHITECT` is the scrap edge for repeated structural workarounds.

## Prototype

**Upstream (`prototype`).** A prototype answers one question, is throwaway, and is committed to a throwaway branch with a context pointer on the implementation issue.

**S50.** `record_prototype` requires the question, verdict, and branch. It writes `MEASURED` evidence with method `prototype` and the branch as the artifact, and keeps the optional issue pointer.

## Design (frontend)

**Upstream (`frontend-design`).** Intentional visual direction for web UI. **S50** routes it only for `frontend` runs, adds `vercel-react-best-practices` only when a run constraint names React or Next.js, and refuses `DESIGN -> CONFIRM_TDD_SEAMS` until a `design.<item>` decision exists for each of subject, audience, primary job, visual direction, information hierarchy, layout, typography, interaction model, responsive behavior, loading state, empty state, error state, and accessibility.

## TDD seams

**Upstream (`tdd`).** Tests live only at seams confirmed with the user. One failing test, then the minimum code to pass it. Refactoring is not part of the loop.

**S50.** `propose_seams` blocks on `seam_confirmation`. `confirm_seams` is human-only. `record_test` at an unconfirmed seam is rejected. `CONFIRM_TDD_SEAMS -> BUILD_GRAPH` needs at least one confirmed seam.

## The diagnostic-test exception (bug)

**Upstream (`diagnosing-bugs`).** Build a red-capable feedback loop before any hypothesis. If none can be built, stop and say what access or artifact is missing.

**S50.** In `DIAGNOSE`, `record_diagnostic` accepts a loop (failing test, HTTP, CLI fixture, browser, trace replay, throwaway program, fuzz, bisect, differential, human-assisted) before any seam is confirmed. This is the only test-like artifact allowed ahead of seam confirmation, and it is temporary:

1. `record_root_cause` needs a red loop.
2. After `CONFIRM_TDD_SEAMS` confirms the permanent seam, `promote_diagnostic` moves the loop there. Promotion to an unconfirmed seam is refused with a `seam_confirmation` gate.
3. PR-ready needs a root cause, a promoted loop, and no loop still red.

With no possible loop, `declare_inconclusive` sets the run `INCONCLUSIVE` with what is missing. The run cannot advance until a new loop is recorded.

## Graph

**S50.** `build_graph` rejects layer-named nodes (`database`, `backend`, `frontend`, `tests`, `api`, `ui`, `schema`, `migration`), unknown dependencies, cycles, and empty write sets. Concurrency rules are in [architecture.md](architecture.md#concurrency).

## Integrate

**S50.** One owner, `integrator`, applies `integrate_node` with the new revision and changed paths. The change stales evidence whose dependencies match. Worker evidence at an earlier revision does not prove the integrated revision.

## Review

See [verification.md](verification.md#review).

## Freeze and PR-ready

`freeze_revision` pins the current revision. `REVERIFY_STALE -> PR_READY` passes only when `prReadyBlockers` is empty. A later revision change moves a `PR_READY` run back to `REVERIFY_STALE`.

## Authorization

**S50.** `request_authorization` always blocks for force-push, merge, deploy, destructive data deletion, public messages, customer communication, sensitive-data disclosure, and other irreversible actions. Only `grant_authorization` with the exact action and scope clears it, and it is human-only. A broad autonomy grant does not clear it.
