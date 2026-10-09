GOAL
Close HOW-TASK-AGENT-TYPE so a live how-turn Task that uses `agent_type: "explore"` with name `how-explainer` and a readonly prompt is recognized as the Method A explainer spawn (sets `spawned`), matching observed pair-investigate-3 behavior without weakening the gate.

SCOPE
May edit:
- extensions/pi-pstack/src/how-spawn-gate.ts
- extensions/pi-pstack/test/how-spawn-gate.test.ts
- extensions/pi-pstack/docs/how-explainer-spawn-design.md (only if needed for the measured contract)
May write parity/briefs/reports/u-how-task-agent-type-report.md
Must not edit mismatches.json, requirements.json, progress.md.

CONTEXT
Mismatch HOW-TASK-AGENT-TYPE. Pair investigate-3 pi 951a315d: gate blocked read, then `task` with `agent_type: explore`, `name: how-explainer`, prompt starting `Readonly task:`. `explainerTaskStarted` currently requires generalPurpose / general-purpose. Subagent still ran. Method A spawn-before-answer already held.
Prefer the smallest lever: widen recognition for how-explainer + readonly (+ explore or generalPurpose). Do not auto-spawn from the host. Do not remove the gate.

ACCEPTANCE
- Unit test covers the live 951a315d Task shape and still rejects non-readonly / non-explainer Tasks.
- Existing how-spawn-gate tests pass.
- `bunx vitest run test/how-spawn-gate.test.ts` and `bun run typecheck` in extensions/pi-pstack pass.
- Report states the chosen recognition rule with evidence pointers.

VERIFY
Commands above. Do not require a full paired recapture in this unit (coordinator will schedule that).

TIMEBOX
45 minutes.

FORBIDDEN
No commit, no ledger edits, no gt/rebase/force-push, no scope expansion into write-card.

REPORT
parity/briefs/reports/u-how-task-agent-type-report.md

STANDING
Obey orch preferences.md verbatim.
