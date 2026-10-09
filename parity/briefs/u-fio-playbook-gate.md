GOAL
Repair Pi `/figure-it-out` so an auditable playbook (phases + falsifiable done predicate) lands on disk before any product-code edit, close FIGURE-IT-OUT-PLAYBOOK-FIRST, and recapture a linked pass-paired run.

SCOPE
May edit `extensions/pi-pstack/src/**` (prefer a gate analogous to `why-spawn-gate.ts` / `how-spawn-gate.ts`), tests, `parity/evidence/figure-it-out/`, capture scripts, `parity/briefs/reports/u-fio-playbook-gate-report.md`.
Must not edit ledgers.

CONTEXT
Mismatch FIGURE-IT-OUT-PLAYBOOK-FIRST from `parity/evidence/figure-it-out/pair-figure-it-out-playbook-first-1.json`: Cursor wrote `decisions.tsv` before `src/`; Pi one bash wrote product then `DECISIONS.md`. Skill text already says deliverable before any code. Standing orders at orch preferences path.

ACCEPTANCE
- Product gate/tests green via package test script.
- Linked recapture: both hosts `playbook_before_product` (FS/session ordering).
- Report for coordinator; no ledger edits.

VERIFY
Real PTY both sides (or Pi + reuse Cursor if identical fixture). Re-read poll/session order.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No commit. No fabricating playbook timestamps.

REPORT
parity/briefs/reports/u-fio-playbook-gate-report.md

STANDING
Obey orch preferences.md.
