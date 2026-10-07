# Feature runs

Start with `s50 feature "<objective>" [--consumer kind:path] [--criteria a;b] [--constraints a;b] [--non-goals a;b]`. The start walks `START -> PREFLIGHT -> CLASSIFY -> CLARIFY`, or stops blocked in `PREFLIGHT` when a required skill is missing.

The forward edges after classification come from `src/orchestrator/transitions.ts`:

```
CLARIFY -> DOMAIN -> ARCHITECT -> PROTOTYPE | DESIGN | CONFIRM_TDD_SEAMS
PROTOTYPE -> ARCHITECT | DESIGN | CONFIRM_TDD_SEAMS
DESIGN -> PROTOTYPE | CONFIRM_TDD_SEAMS
CONFIRM_TDD_SEAMS -> BUILD_GRAPH -> IMPLEMENT -> INTEGRATE -> REVIEW -> VERIFY
VERIFY -> FREEZE_REVISION -> REVERIFY_STALE -> PR_READY
```

The failure edges send work back to its owner, as `route_failure` uses them:

```
IMPLEMENT -> ARCHITECT
INTEGRATE -> IMPLEMENT
REVIEW -> IMPLEMENT | ARCHITECT | DESIGN | CONFIRM_TDD_SEAMS
VERIFY -> IMPLEMENT | DESIGN
REVERIFY_STALE -> IMPLEMENT
PR_READY -> REVERIFY_STALE
```

Route skills: CLARIFY `grilling`, DOMAIN `domain-modeling` (only when the model changes), ARCHITECT `codebase-design`, PROTOTYPE `prototype`, CONFIRM_TDD_SEAMS `tdd`.

## CLARIFY

Ask the whole unblocked frontier as one round. A question whose `dependsOn` names an undecided question waits for a later round. Look facts up yourself and put only decisions to the user, numbered, each with your recommended answer:

```
❓ **Q1** - **<title>**: <body, options>

➡️ <recommended answer>
```

```json
{"kind":"ask_decisions","questions":[{"id":"q-format","title":"Export format","body":"CSV or TSV?","recommendation":"CSV","dependsOn":[]}]}
{"kind":"answer_decisions","decisions":[{"id":"q-format","question":"CSV or TSV?","answer":"CSV","decidedBy":"user"}]}
```

When no question is left, an empty round asks for the shared-understanding confirmation. Implementation waits for it:

```json
{"kind":"ask_decisions","questions":[]}
{"kind":"confirm_understanding"}
```

## DOMAIN

Decide whether the change alters terms, relationships, states, or invariants. With `no`, the existing glossary is consumed and the run moves on. With `yes`, follow `domain-modeling` and record the model:

```json
{"kind":"answer_decisions","decisions":[{"id":"domain.model_change","question":"Does this change terms or invariants?","answer":"yes","decidedBy":"fact"}]}
{"kind":"record_domain","terms":["invoice"],"invariants":["every invoice exports once"],"scenarios":["export all invoices"]}
```

## ARCHITECT and PROTOTYPE

Ground the callers first. Propose at least two structurally different designs and record the reason for the choice. When a question needs observation, record it as `architecture.uncertainty`; the run then goes to PROTOTYPE until a prototype answers that exact question.

```json
{"kind":"propose_designs","candidates":[{"id":"stream","summary":"stream rows","tradeoffs":"more code"},{"id":"buffer","summary":"buffer rows","tradeoffs":"memory"}]}
{"kind":"choose_design","id":"stream","reason":"bounded memory","interfaces":["exportCsv(stream)"],"seams":["seam-cli"],"ownership":["src/export"]}
{"kind":"answer_decisions","decisions":[{"id":"architecture.uncertainty","question":"What needs observing?","answer":"does streaming keep memory flat?","decidedBy":"fact"}]}
{"kind":"record_prototype","question":"does streaming keep memory flat?","verdict":"yes, flat at 40 MB","branch":"prototype/streaming-memory","issuePointer":null}
```

## CONFIRM_TDD_SEAMS

Propose seams at public interfaces, each with what it catches and misses. The user confirms them. Then work one vertical behavior at a time: record RED, write the minimum code, record GREEN. Refactoring belongs to REVIEW.

```json
{"kind":"propose_seams","seams":[{"id":"seam-cli","description":"invoices CLI stdout","catches":"format regressions","misses":"disk errors"}]}
{"kind":"confirm_seams","ids":["seam-cli"]}
{"kind":"record_test","seam":"seam-cli","name":"export prints a header row","result":"red","command":"bun run test -- export","observed":"1 failed","dependencies":["src/export/**"]}
{"kind":"record_test","seam":"seam-cli","name":"export prints a header row","result":"green","command":"bun run test -- export","observed":"1 passed","dependencies":["src/export/**"]}
```

## BUILD_GRAPH, IMPLEMENT, INTEGRATE

Slice by behavior. Layer-named objectives, unknown dependencies, cycles, empty write sets, and nodes without an owner or expected behavior are rejected.

```json
{"kind":"build_graph","nodes":[{"id":"export-csv","objective":"export listed invoices as CSV","dependencies":[],"owner":"worker-1","writeSet":["src/export/**"],"schemas":[],"migrations":[],"definesInterfaces":[],"consumesInterfaces":[],"runtimeOwnership":[],"expectedBehavior":"invoices export prints one row per invoice","verification":"cli"}]}
{"kind":"start_nodes","ids":["export-csv"]}
{"kind":"complete_node","id":"export-csv","passed":true}
{"kind":"integrate_node","id":"export-csv","revision":"0123456789abcdef0123456789abcdef01234567","changedPaths":["src/export/csv.ts"],"integrator":"integrator"}
```

The revision must be the current `HEAD`, and S50 reads the changed paths from Git itself. One integrator owns integration, and it may not own a node. Several nodes start together only when the host has independent agents and isolated worktrees and the nodes do not conflict. On such a host every node gets `.s50/worktrees/<node>`; a serial host runs one node at a time. Then see [verification.md](verification.md).
