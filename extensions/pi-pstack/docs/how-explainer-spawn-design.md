# HOW-WORKFLOW-EXPLAINER-STEP repair designs

Method A lock. Simple `/how` must start one readonly explainer Task before the final answer.

Root cause. Delivery of Step 2b is closed. The parent still skips because Pi injects `<subagent_usage>` with "Default to doing the work yourself" and "Do not delegate work you can finish in five or fewer direct tool calls." That heuristic matches a simple investigation and overrides Step 2b.

## Design A. Spawn gate on the how turn

Detect `<skill name="how"` in `before_agent_start.prompt`. Arm a `tool_call` gate that blocks direct exploration tools until a `Task` call with `readonly: true` and `subagent_type: generalPurpose` is accepted. Replace `subagent_usage` for that turn so the five-or-fewer heuristic does not apply. One guarded `agent_before_settle` continue if the turn would finish without that Task.

Pros. Model still builds the explainer prompt. Small surface. Matches reference "parent calls Task". Deterministic against direct-tool shortcuts.

Cons. A text-only answer after the single continue can still skip. Live recapture remains the Method A proof.

## Design B. Host auto-spawn

On how delivery or settle-without-Task, the extension calls `Task` itself with a filled explainer prompt.

Pros. Strongest Method A signal.

Cons. Couples commands or settle hooks to WorkerRuntime and explainer-prompt assembly. Larger than the lock needs.

## Choice

Design A. Smallest lever that makes spawn the observed path for any parent that tries direct tools first.
