GOAL: Import host-continuation research into the main parity ledger without overwriting prior archives; independently verify recorded source and quote hashes; reconcile transport-scope conflicts into unresolved or refined dependency proposals.
SCOPE: May write only under /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/research/cursor-host-continuation/ and /Users/josh-desktop/src/personal/pi-pstack-parity-again/parity/reviews/host-continuation-import-audit.json. Must not modify requirements.json acceptance bytes, source-lock status to complete, or any extensions/ code.
CONTEXT: Source artifacts at /private/tmp/pi-pstack-host-contracts/parity/research/cursor-host-continuation/ (report.md 126 lines, audit-evidence.py, dependency-proposals.json, candidate-scenarios.json, preserved/, read-receipts). Main repo already has archived cursor-host research under parity/research/cursor-host/. Progress next-action names completing unread pool spans 1-364 and 410-901 and reconciling transport scope. Official plugins HEAD ccb5507; pstack 0.15.15.
ACCEPTANCE:
- Copied/imported research directory exists under owned path with content digests recorded
- Parent-auditable JSON audit reports whether each preserved source hash and quote span matches, mismatches, or was unread
- Transport-scope conflicts listed with concrete evidence pointers (not resolved by guessing)
- No definition freeze; no parity pass claimed
VERIFY: python3 audit against preserved digests; shasum files; do not run model-backed Cursor
TIMEBOX: 45 minutes then return partial findings
FORBIDDEN: no gt, rebase, force-push, no edits outside SCOPE, no weakening requirements, no fabricating reads
REPORT: status, paths written, hash audit summary counts, open conflicts, deviations
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
