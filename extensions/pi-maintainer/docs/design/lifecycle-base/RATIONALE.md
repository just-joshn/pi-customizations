# Candidate 2 rationale

## Problem

Pi users need Aider's reply-text editing and bounded repair workflow without losing Pi's sessions, transport, compaction, or TUI. Aider's `Coder` owns an entire exchange, including a nested editor invocation in architect mode. Pi exposes individual request and response boundaries. Treating those boundaries as independent handlers would split the same exchange policy across the extension. Installed Pi 1.1.0 also lacks a public mid-run structured prompt setter and does not preserve source IDs through context transforms. Those limits constrain the design.

## Usage (caller's view)

A user selects files with `/add` and `/read-only`, then submits `/architect Add escaped identifiers.`. Pi streams the architect's answer. After approval, Pi streams an editor-model answer with Aider edits. File failures become bounded reflection messages. `/architect` without text changes the persistent mode. A one-shot command returns to the prior mode without discarding its resulting conversation.

The package caller installs one extension function. The Pi adapter hands a finalized reply to `controller.completeReply`, then composes its own drafts after `event.entries`. Model routing and request projection consult the same active frame. See [USAGE-AND-SHAPE.md](USAGE-AND-SHAPE.md) for the usage-first call sites and signatures.

## Shape

The central structure is an exchange with an ordinary, architect, or editor coder frame. An editor frame contains a suspended architect continuation. The controller makes direct named calls for permission, application, commits, lint, shell suggestions, and tests. It does not interpret a generic effect language or initiate model requests. Model the Domain made nested coder ownership explicit rather than distributing phase booleans across Pi hooks.

Pi branch records hold domain snapshots, response receipts, and synthetic dialogue facts. Real transcript contents stay only in Pi entries. Request projection joins domain metadata to Pi's compaction-aware projected messages and reads fresh file contents. Boundary Discipline keeps Pi message and storage schemas private to the adapter.

The public installer hides lifecycle coordination, persistence decoding, request shaping, and mode restoration. The private controller exposes domain operations rather than every pipeline stage. Laziness Protocol and Minimize Reader Load remove the event/effect interpreter, dispatcher registry, and parallel transcript manager. Separate Before Serializing Shared State gives the editor and architect independent file-set values and reflection counters. Make Operations Idempotent requires an interrupted state when a persisted intent has no finish receipt. Encode Lessons in Structure separates prepared targets from actual writes and passed checks from checks that never ran.

## Synthesis decision

Pending the parent arena's comparison. Candidate 2 does not select a winner or inspect the picker rubric. The proposed base is the domain controller. Its strongest uncertainty is independent phase history across default Pi compaction, not response-order expressiveness.

## Tradeoffs accepted

- We accept a substantial exchange controller in exchange for one owner of Aider response order.
- We accept request-local prompt reconstruction in exchange for using the supported full-transcript hook. Raw Pi system entries do not then exactly describe the editor prompt.
- We accept explicit interrupted recovery in exchange for avoiding dishonest exactly-once claims across filesystem, shell, and session writes.
- We accept a feasibility gate before implementation in exchange for not bypassing compaction or dropping another extension's contributions.

## Alternatives considered

A generic reducer/effect interpreter would represent every response transition as an event, return effect records, and dispatch them through filesystem, confirmation, transcript, and model adapters. It hides some transition mechanics, but its callers must coordinate effect execution and completion events. Architect/editor nesting adds suspended continuations, result correlation, and state synchronization to the effect language. The domain controller hides more Aider-specific coordination behind a smaller calling interface and keeps the ordering readable in one module.

A separate Pi session for the editor gives excellent history isolation and a smaller prompt projector. It loses the one-run user experience and divides transcript, branch, cancellation, and cost ownership across sessions. Restoring all of those at the parent would create host orchestration the task forbids. Calling `ctx.modelRegistry.streamSimple` directly for the editor has a similar flaw. It uses native transport but bypasses the main Pi agent loop for editing. Neither is the proposed fallback.

## Open questions and risks

- Can native `session_before_compact` customization retain separate parent/editor summaries without replacing Pi's compaction ownership, or does strict history parity require a Pi API change?
- Can a supported extension-composition contract supply enough provenance for phase filtering when earlier context handlers rewrite messages?
- Does parity require canonical system-prompt transition entries, or is a reproducible request-local transform acceptable given 1.1.0's public boundary types?
- Which noninteractive confirmation policy and list-valued flag syntax satisfy the operator when Pi cannot provide Aider's stdin prompts or repeated native extension flags?

These are not excuses to invent APIs. [PI-WIRING.md](PI-WIRING.md) names the exact impossible combinations and source evidence. [POLICY-AND-VERIFICATION.md](POLICY-AND-VERIFICATION.md) records the proposed defect rows and the runtime gates.

## Next implementation step

Build the isolated persisted-session scripted-provider experiment that proves architect-to-editor model/prompt handoff and deliberately forces compaction across the phase boundary before implementing the controller.
