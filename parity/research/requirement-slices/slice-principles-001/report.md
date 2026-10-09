# Slice principles-001 report

throughput checkpoint: n/a, read-only investigation

## Overview

Draft requirement proposals for the 24 leftover principle `SKILL.md` inventory paths from slice-commands-002. Each proposal captures one atomic activation contract. Quotes are frontmatter (`description` plus `disable-model-invocation: true`). Expected observations require poteto leaf-load plus principle-specific falsifiable stops where the skill states them. Proposals live only under this owned path. `parity/requirements.json` was not edited. No dispositions. Leftover queue is empty.

## Key concepts

A requirement proposal here is one independently falsifiable principle activation. The domain record is a typed object with source locator, full-file hash, quote hash, trigger, expected observations, configuration cells, and an unresolved queue. Status stays `draft-proposal`. Nothing is verified. All locked principle files set `disable-model-invocation: true`, so host model-auto-invocation is forbidden in every proposal.

## How it works

1. Leftover inventory was taken from `parity/research/requirement-slices/slice-commands-002/report.md` (24 paths).
2. Each path received one proposal. No path was deferred or disposed as documentation-only. Leaf-load and disable-model-invocation are user-observable via transcript tool traces and locked file bytes.
3. Spans were read from the locked tree under `parity/reference/cursor-plugins/`.
4. File and quote SHA-256 values were recomputed against inventory digests and the stored quotes. Results are rechecked by `verify-hashes.py`.
5. Coverage also asserts the proposal set equals the prior deferred list exactly.

## Where things live

- Proposals: `parity/research/requirement-slices/slice-principles-001/proposals.json`
- Read receipts: `parity/research/requirement-slices/slice-principles-001/read-receipts.json`
- Hash verify lever: `parity/research/requirement-slices/slice-principles-001/verify-hashes.py`
- This report: `parity/research/requirement-slices/slice-principles-001/report.md`

## Counts

- Proposal count: 24
- Prior leftover inventory items: 24
- Covered in this slice: 24
- Disposition count: 0
- Leftover uncovered after this slice: 0

## Hash verification

All 24 proposal quote and full-file hashes recomputed PASS (`python3 verify-hashes.py`). Coverage against slice-commands-002 deferred list PASS.

## Leftover uncovered command or skill inventory items

None. The 24 principle paths from slice-commands-002 are each covered by one draft proposal.

## Unresolved queue summary

- PSTACK-PRIN-ATTACK-PREMISE-001: Census script shape and paired leaf-load timing.
- PSTACK-PRIN-BOUNDARY-001: Boundary judgment and language-specific error shapes.
- PSTACK-PRIN-BUILD-LEVER-001: Triviality threshold and commit policy for one-off scripts.
- PSTACK-PRIN-ENCODE-STRUCTURE-001: Judgment-only rules and mechanism strength order.
- PSTACK-PRIN-EXHAUST-DESIGN-001: Prototype distinctness and Prototype playbook handoff.
- PSTACK-PRIN-EXPERIENCE-FIRST-001: Non-numeric delight oracle and user weighting.
- PSTACK-PRIN-EXPLAIN-NUMBER-001: benchmark-checklist pairing and eval trial rules.
- PSTACK-PRIN-FIX-ROOT-001: Root-cause sufficiency and restart/state scenarios.
- PSTACK-PRIN-FOUNDATIONAL-001: Transcript vs diff evidence and architect handoff.
- PSTACK-PRIN-GUARD-CONTEXT-001: Host fill thresholds and summary fidelity.
- PSTACK-PRIN-LAZINESS-001: Smallest-change judgment and flatten rule.
- PSTACK-PRIN-IDEMPOTENT-001: Crash-injection harness and lockfile PID heuristics.
- PSTACK-PRIN-MIGRATE-DELETE-001: External compatibility gates and time-boxed adapters.
- PSTACK-PRIN-MINIMIZE-READER-001: Qualitative 30-second reader test.
- PSTACK-PRIN-MODEL-DOMAIN-001: Boring-code preference and architect pairing.
- PSTACK-PRIN-NEVER-BLOCK-001: Host AskUserQuestion UX and product-direction boundary.
- PSTACK-PRIN-OUTCOME-ORIENTED-001: Intermediate breakage scope and verification suite identity.
- PSTACK-PRIN-PROVE-IT-001: show-me-your-work commit stakes and host output capture.
- PSTACK-PRIN-REDESIGN-FIRST-001: Incremental redesign phases and attack-the-premise distinction.
- PSTACK-PRIN-SEPARATE-STATE-001: Shared-writer invariant judgment and orch path pairing.
- PSTACK-PRIN-SEQUENCE-UNITS-001: Unit size and prove-it / build-the-lever complementarity.
- PSTACK-PRIN-SUBTRACT-FIRST-001: Dead vs unused judgment and prompt simplification.
- PSTACK-PRIN-TEST-BEHAVIOR-001: Allowed exceptions and mock payload patterns.
- PSTACK-PRIN-TYPE-DISCIPLINE-001: Per-language exhaustiveness and boundary-discipline pairing.

## Gotchas

- Principle skills are inventory entry points with `disable-model-invocation: true`. They are not slash-auto-invoked. Activation is poteto leaf-load when the apply-when condition holds.
- Acceptance definitions stay DRAFT. No freeze. No status set to verified.
- Ledgers were not touched.
