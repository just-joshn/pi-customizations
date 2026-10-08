GOAL: Produce architect design package A for the PTY recorder: event-log-first structure (append-only JSONL event stream + separate attempt identity), with not-implemented TypeScript signatures.
SCOPE: Write only /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/designs/recorder-sketch-a.md and optional /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/designs/recorder-sketch-a/ stubs that throw not implemented. No production code under extensions/.
CONTEXT: Read fully: parity/designs/pty-recorder-frame.md, parity/designs/pty-recorder-grounding.md, ~/.claude/skills/architect/references/rationale-template.md and design-red-flags.md. Structural constraint for A: event-sourced append-only log as the sole source of truth; derived views only.
ACCEPTANCE:
- Design package follows rationale template
- Screened against design-red-flags with explicit pass/fail notes
- Public API surface named with types/signatures
- First-slice non-model fixture exercise specified
- No comparator/acceptance/parity verdict APIs
VERIFY: file exists; contains sections for data shape, ownership, API, red-flag screen, first-slice tests
TIMEBOX: 40 minutes
FORBIDDEN: no implementation fill-in, no gt/rebase/force-push, no editing sketch B or ledgers
REPORT: path, structural thesis one line, red-flag outcomes, open risks
STANDING ORDERS (verbatim):
1. Done predicate: every requirement in parity/requirements.json verified by paired Cursor+Pi user journeys against the shipped package digest; zero unresolved mismatches; completion gate green.
2. Official locks: pstack 0.15.15 at cursor/plugins ccb5507cec1546dc88135c1139c811e6c59115ba; Pi v1.1.0; cursor-agent 2026.10.01-e373342.
3. Coordinator owns parity/ ledgers and integration; workers get exclusive branches/worktrees and owned paths only.
4. No scope reduction for platform differences, external services, or prior accepted exclusions. Keep unsatisfied requirements active.
5. Never fabricate evidence, process liveness, model identity, or approval. Unverified remains unverified.
6. Preserve operator gates: no spending, force-push, deploy, deletion, or customer messages without explicit account-owner action.
7. Do not invoke Cursor as an implementation backend for Pi. Cursor is reference-only.
8. Acceptance definitions stay DRAFT until independent owner freezes them; implementation owner cannot unilaterally change the oracle.
9. No gt, rebase, or force-push by workers. One writer per path.
10. Model policy: poteto-agent for playbook code workers; different model family for verifiers; inherit-parent when setup-pstack says so.
11. Cursor included_usage is currently exhausted until ~2026-10-12; park model-backed reference journeys; continue non-model work.
12. Brief every spawn with GOAL/SCOPE/ACCEPTANCE/VERIFY/FORBIDDEN/REPORT/STANDING.
