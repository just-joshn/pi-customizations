# Slice commands-002 report

throughput checkpoint: n/a, read-only investigation

## Overview

Draft requirement proposals for the leftover command and skill inventory from slice-commands-001. Prefer Benny automation skills and user-facing skills. Principle skills stay deferred. Proposals live only under this owned path. `parity/requirements.json` was not edited.

## Key concepts

A requirement proposal here is one independently falsifiable entry-point behavior. The domain record is a typed object with source locator, full-file hash, quote hash, trigger, expected observations, configuration cells, and an unresolved queue. Status stays `draft-proposal`. Nothing is verified.

## How it works

1. Leftover inventory was taken from `parity/research/requirement-slices/slice-commands-001/report.md` (41 paths).
2. Non-principle leftovers were covered first (Benny pack skills, agents, and user skills). Principle `SKILL.md` paths were left for a later slice.
3. Spans were read from the locked tree under `parity/reference/cursor-plugins/`.
4. File and quote SHA-256 values were recomputed against inventory digests and the stored quotes. Results are in `proposals.json` under `hashVerification`, and are rechecked by `verify-hashes.py`.
5. Existing ledger requirements for `/poteto-mode` enter semantics and `/setup-pstack` discovery or budget labels were not re-proposed. poteto-mode coverage here is playbook todolist matching. setup-pstack coverage here is the idempotent rule write step.

## Where things live

- Proposals: `parity/research/requirement-slices/slice-commands-002/proposals.json`
- Read receipts: `parity/research/requirement-slices/slice-commands-002/read-receipts.json`
- Hash verify lever: `parity/research/requirement-slices/slice-commands-002/verify-hashes.py`
- This report: `parity/research/requirement-slices/slice-commands-002/report.md`

## Counts

- Proposal count: 17
- Prior leftover inventory items: 41
- Covered in this slice: 17
- Leftover uncovered after this slice: 24 (all principle skills)

## Hash verification

All 17 proposal quote and full-file hashes recomputed PASS (`python3 verify-hashes.py`).

## Leftover uncovered command or skill inventory items

- `pstack/skills/principle-attack-the-premise/SKILL.md`
- `pstack/skills/principle-boundary-discipline/SKILL.md`
- `pstack/skills/principle-build-the-lever/SKILL.md`
- `pstack/skills/principle-encode-lessons-in-structure/SKILL.md`
- `pstack/skills/principle-exhaust-the-design-space/SKILL.md`
- `pstack/skills/principle-experience-first/SKILL.md`
- `pstack/skills/principle-explain-the-number/SKILL.md`
- `pstack/skills/principle-fix-root-causes/SKILL.md`
- `pstack/skills/principle-foundational-thinking/SKILL.md`
- `pstack/skills/principle-guard-the-context-window/SKILL.md`
- `pstack/skills/principle-laziness-protocol/SKILL.md`
- `pstack/skills/principle-make-operations-idempotent/SKILL.md`
- `pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md`
- `pstack/skills/principle-minimize-reader-load/SKILL.md`
- `pstack/skills/principle-model-the-domain/SKILL.md`
- `pstack/skills/principle-never-block-on-the-human/SKILL.md`
- `pstack/skills/principle-outcome-oriented-execution/SKILL.md`
- `pstack/skills/principle-prove-it-works/SKILL.md`
- `pstack/skills/principle-redesign-from-first-principles/SKILL.md`
- `pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md`
- `pstack/skills/principle-sequence-verifiable-units/SKILL.md`
- `pstack/skills/principle-subtract-before-you-add/SKILL.md`
- `pstack/skills/principle-test-behavior-not-implementation/SKILL.md`
- `pstack/skills/principle-type-system-discipline/SKILL.md`

## Unresolved queue summary

- PSTACK-CMD-COMMENT-SICKO-FIRST-OUTPUT-001: Exact catchphrase whitespace and no-comments orchestration pairing remain open.
- PSTACK-CMD-POTETO-AGENT-READ-SKILL-001: Background scheduling and strict resume cases need paired observation.
- PSTACK-CMD-BENNY-REPRO-FAIL-CLOSED-001: Fail-closed message text and positive triage-marker path need journeys.
- PSTACK-CMD-SETUP-BENNY-NOT-SLASH-001: Accidental slash surfacing and copy-pack conflicts are unresolved.
- PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001: Positive-path verdict post and tracker dedupe need separate requirements.
- PSTACK-CMD-AUTOMATE-ME-EXISTING-SKILL-001: AskQuestion copy and update-mode mining window need UI or transcript pairing.
- PSTACK-CMD-BENCHMARK-CHECKLIST-EVIDENCE-001: Per-question table enforcement and noise interleaving need scenarios.
- PSTACK-CMD-BLAST-RADIUS-RUN-PROOF-001: When step 5 is required versus step 4 remains judgmental.
- PSTACK-CMD-BRO-RESTATE-001: Edit permission and multi-message selection are unspecified.
- PSTACK-CMD-MAINTAIN-VERIFY-OUTCOMES-001: Live-pass doctor invariants and none-candidate redirect need journeys.
- PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001: Tailscale exposure and confirm-card UX need observation.
- PSTACK-CMD-POTETO-PLAYBOOK-TODO-001: Todolist tool fallback checklist behavior needs paired observation.
- PSTACK-CMD-RECALL-CAPSULE-001: Default 7-day window and shared-record steering need separate requirements.
- PSTACK-CMD-SETUP-WRITE-RULE-001: Exact alwaysApply frontmatter shape on both hosts needs file observation.
- PSTACK-CMD-TEACH-HOW-WHY-001: Single-skill sufficiency judgment and diagram build-up need further requirements.
- PSTACK-CMD-TYPESCRIPT-PATHS-001: Host path-glob auto-attach is unverified at runtime.
- PSTACK-CMD-UNSLOP-PROCESS-001: Cross-skill pairing with poteto-mode reply rules needs observation.

## Gotchas

- Host slash-menu discoverability for Benny files is explicitly denied by setup-benny text, yet inventory still lists those paths via the skills glob. Runtime menu observation remains unresolved.
- Principle skills are discoverable inventory entry points and form the entire leftover queue after this slice.
- Acceptance definitions stay DRAFT. No freeze. No status set to verified.
- Ledgers were not touched.
