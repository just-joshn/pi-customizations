# Architecture cross-judgment

Read Candidate A and Candidate B in full. Compared their claims with the upstream pstack inventory, key skills/playbooks, current official Pi docs/sdk.md and docs/packages.md, and actual extension event types and runner implementation.

## Scores

Scores use 1 to 5, where 5 is strongest for this task. They judge the proposed shape, not implementation completion.

| Criterion | A | B | Evidence |
|---|---:|---:|---|
| Source fidelity | 5 | 4 | A keeps all upstream bytes immutable and adds the host compatibility boundary. B preserves an immutable copy but creates a second transformed skill tree whose 47 skills and 23 playbooks must stay synchronized. B is more precise about leaving Benny undiscovered. |
| Current Pi API correctness | 4 | 5 | Both select current @earendil-works packages, SDK SessionManager and settled lifecycle. A correctly rejects an invented result property, but mistakes mutable event.systemPromptOptions for a documentation discrepancy. B's structured prompt approach is supported by actual source. |
| Lifecycle behavior | 5 | 5 | Both address background identity, authoritative session history, resume, cancellation, shutdown, branch state and completion after recovery. A is more explicit about no live resources in factory and parent abort ownership. B adds precise safe-boundary delivery and state/error metadata. |
| Maintainability | 5 | 3 | A has one canonical instruction tree and small host adapter. B's generated operational tree adds transformation rules, output maintenance and broad proof burden. Those costs are justified only for a host binding that a concise explicit bridge cannot express. |
| Explicit unsupported host contracts | 4 | 5 | Both reject silent local replacement of cloud and universal parity claims. B names stronger Benny credential-isolation and approval transitions and exact external dependency gates. A must not expose Benny as slash commands casually. |
| Total | 23 | 22 | Choose A's immutable source shape, with B's explicit dependency/acceptance contracts. |

## Recommended base and grafts

Use A as the base. Preserve the entire pinned upstream subtree and manifest. Expose main skill roots natively and exact directory-slug aliases, backed by original full SKILL.md text and absolute source directory. Use a small documented compatibility section and tools to map host contracts. Do not silently rewrite every source reference or build a general Reference emulator.

Graft these parts from B.

1. Keep Benny's three operational skills out of discovery and slash aliases. Upstream explicitly says direct file instructions, not registered skills. Shipping Benny content does not mean enabling automations.
2. Preserve a machine-readable capability matrix for every required host contract with supported, configured, unavailable states and source pointers. An unsupported dependency blocks only its actual gate; it never becomes an invented replacement.
3. Make setup a real contract. Preserve all 17 role labels, ordered duplicate panel seats, parent aliases, exact four budget labels, validation, confirmation and atomic persistence. Model family selection is explicit and credentials-backed.
4. Use documented mutation of event.systemPromptOptions for mode instructions, or a typed custom message when appropriate. The source signature supports direct mutable sections. Never return a nonexistent systemPromptOptions field.
5. Keep B's deterministic real-Pi integration acceptance list. Exercise settled completion with retry/queued follow-up, persistent session resume, nested delegation, parent delivery and branch isolation. Mocks of a homegrown task manager cannot prove these.
6. Preserve B's distinction between behavioral read-only instructions and actual capability isolation. Benny requires credentials plus all Slack writes removed. SDK sessions sharing the process/environment cannot establish that by tool-name filtering alone; declare unavailable unless real isolation exists.
7. Handle all mode entry points. Directory alias, native `/skill:` invocation, and explicit natural-language activation must not diverge. Natural-language off should use an explicit mode tool rather than a broad regex matching quoted text.

A's Reference-compatible Task tool name is reasonable because immutable prompts refer to Task throughout, but the tool must document exactly which parameters it supports and reject unsupported cloud semantics. Native management tool names are also acceptable when the compatibility section makes their translation exact. Avoid implementing both complete APIs as redundant layers.

## Corrections required before implementation

- A's claim of a docs/type mismatch is incorrect as framed. `BeforeAgentStartEvent.systemPromptOptions` is mutable by declaration. `BeforeAgentStartEventResult` has only message/systemPrompt because handlers mutate the event object. `runner.ts` passes shared currentOptions and returns it; AgentSession then consumes it. Returning systemPromptOptions would be wrong, mutating it is correct.
- A says child discovery would recursively spawn duplicate supervisors. Discovery reruns extension registration, but duplication only becomes a problem if factories start live resources or register uncontrolled supervisors. Keep registration inert and explicitly choose child extensions; do not use this concern to strip required connectors.
- A proposes including nested Benny assets with a command namespace. Reject the command namespace. The source intentionally excludes those operational skills from discovery.
- Both must report that an in-process SDK child disappears on host death. Persisted transcripts permit recovery, not uninterrupted remote execution.
- Do not equate a checklist of retained clauses with 100% observed behavior parity. Model instruction adherence and required hosted services remain outside what local deterministic tests establish.

## Implementation boundary

The reviewable deliverable is complete source preservation plus tested native adapters and a precise unsupported-capability report. Neither design can fulfill unconditional 100% platform parity without Reference service access, external skill dependencies and actual cloud isolation. Keep this fact in package-facing documentation and final reporting, not only design notes.
