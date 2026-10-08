GOAL: Close the acceptance verifier symlink escape (--write-hashes must not follow a symlink MANIFEST.sha256 outside the acceptance root) with a failing regression then fix, without changing definition oracle bytes.
SCOPE: Work in /private/tmp/pi-pstack-parity-acceptance-owner on branch parity/acceptance-owner. May edit only parity/acceptance/tools/** and add tests under parity/acceptance/tools/** or parity/acceptance/review/**. Must not modify setup-pstack/definitions.json bytes or record-hashes.json values.
CONTEXT: Parent reproduced: replacing MANIFEST.sha256 with a symlink caused --write-hashes to exit 0 and overwrite sibling canary outside acceptance root. Evidence: parity repo reviews/acceptance-symlink-parent-reproduction.md and evidence/acceptance-symlink-*. Definitions sha256 must remain e4e84566a31803388d70e977f7a2bf4e7d53afe0c931543f877328e860805cb4. Authorization remains NONE. No freeze.
ACCEPTANCE:
- RED test fails on symlink MANIFEST escape before fix
- GREEN after fix; escape rejected with non-zero exit and no external write
- definitions.json and record-hashes.json unchanged (byte compare)
- structural PASS still does not grant authorization
VERIFY: run the verifier selftest and the symlink regression; shasum definitions.json
TIMEBOX: 45 minutes
FORBIDDEN: no freeze, no gt/rebase/force-push, no changing oracle expectations, no claiming external custody solved
REPORT: status, before/after hashes, commands run, residual custody limits
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
