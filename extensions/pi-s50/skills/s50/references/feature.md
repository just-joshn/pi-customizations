# Feature runs

Start: `s50 feature "<objective>" [--consumer kind:path] [--criteria a;b] [--capabilities json]`.
The start runs `START -> PREFLIGHT -> CLASSIFY -> CLARIFY`.

Phase edges (from `src/orchestrator/transitions.ts`):

```
CLARIFY -> DOMAIN -> ARCHITECT -> PROTOTYPE | DESIGN | CONFIRM_TDD_SEAMS
PROTOTYPE -> ARCHITECT | DESIGN | CONFIRM_TDD_SEAMS
DESIGN -> PROTOTYPE | CONFIRM_TDD_SEAMS
CONFIRM_TDD_SEAMS -> BUILD_GRAPH -> IMPLEMENT -> INTEGRATE -> REVIEW -> VERIFY
VERIFY -> FREEZE_REVISION -> REVERIFY_STALE -> PR_READY
```

Route skills: CLARIFY `grilling`; DOMAIN `domain-modeling` (only on model change); ARCHITECT `codebase-design`; PROTOTYPE `prototype`; CONFIRM_TDD_SEAMS `tdd`.

## CLARIFY: grilling rounds

Ask the whole unblocked frontier in one round. A question that depends on another open question waits for a later round. Look facts up yourself; put only decisions to the user.

```
❓ **Q1** - **<title>**: <body, options>

➡️ <recommended answer>
```

Record answers, then confirm shared understanding before any implementation:

```json
{"kind":"answer_decisions","decisions":[{"id":"q1","question":"...","answer":"...","decidedBy":"user"}]}
{"kind":"confirm_understanding"}
```

## DOMAIN, ARCHITECT, PROTOTYPE

```json
{"kind":"record_domain","terms":["..."],"invariants":["..."],"scenarios":["..."]}
{"kind":"propose_designs","candidates":[{"id":"a","summary":"...","tradeoffs":"..."},{"id":"b","summary":"...","tradeoffs":"..."}]}
{"kind":"choose_design","id":"a","reason":"...","interfaces":["..."],"seams":["..."],"ownership":["..."]}
{"kind":"record_prototype","question":"...","verdict":"...","branch":"...","issuePointer":null}
```

`propose_designs` needs at least 2 candidates.

## CONFIRM_TDD_SEAMS

Propose seams at public interfaces; the user confirms. No test at an unconfirmed seam.

```json
{"kind":"propose_seams","seams":[{"id":"s1","description":"...","catches":"...","misses":"..."}]}
{"kind":"confirm_seams","ids":["s1"]}
{"kind":"record_test","seam":"s1","test":"tdd"}
```

Loop is red then green: one failing test, minimal code to pass, next slice. No refactor step in the loop; refactoring belongs to REVIEW.

## BUILD_GRAPH, IMPLEMENT, INTEGRATE

Vertical slices only; horizontal layer names, unknown deps, and cycles are rejected.

```json
{"kind":"build_graph","nodes":[{"id":"n1","objective":"...","dependencies":[],"owner":"...","writeSet":["src/x/**"],"schemas":[],"migrations":[],"definesInterfaces":[],"consumesInterfaces":[],"runtimeOwnership":[],"expectedBehavior":"...","verification":"test"}]}
{"kind":"start_nodes","ids":["n1"]}
{"kind":"complete_node","id":"n1","passed":true}
{"kind":"integrate_node","id":"n1","revision":"<sha>","changedPaths":["src/x/a.ts"]}
```

More than one node starts together only when the frontier allows it, nodes do not conflict, and the host has independent agents plus isolated worktrees. Then see [verification.md](verification.md).
