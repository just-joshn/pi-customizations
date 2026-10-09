# Slice commands-001 report

throughput checkpoint: n/a, read-only investigation

## Overview

Draft requirement proposals for pstack slash commands and skill entry points. Proposals live only under this owned path. `parity/requirements.json` was not edited.

## Key concepts

A requirement proposal here is one independently falsifiable entry-point behavior. The domain record is a typed object with source locator, full-file hash, quote hash, trigger, expected observations, configuration cells, and an unresolved queue. Status stays `draft-proposal`. Nothing is verified.

## How it works

1. Topic inventory was enumerated from `parity/inventory.json` as plugin skill registration, every `pstack/**/skills/**/SKILL.md`, and the two agent entry files.
2. Spans were read from the locked tree under `parity/reference/cursor-plugins/`.
3. File and quote SHA-256 values were recomputed and checked against inventory digests and the stored quotes. Results are in `proposals.json` under `hashVerification`.
4. Existing ledger requirements for `/poteto-mode` enter semantics and `/setup-pstack` discovery or budget labels were not re-proposed.

## Where things live

- Proposals: `parity/research/requirement-slices/slice-commands-001/proposals.json`
- Read receipts: `parity/research/requirement-slices/slice-commands-001/read-receipts.json`
- This report: `parity/research/requirement-slices/slice-commands-001/report.md`

## Counts

- Proposal count: 17
- Topic inventory items: 57
- Covered by at least one proposal: 16
- Leftover uncovered in this topic: 41

## Hash verification

All 17 proposal quote and full-file hashes recomputed PASS.

## Leftover uncovered command or skill inventory items

- `pstack/agents/comment-sicko.md`
- `pstack/agents/poteto-agent.md`
- `pstack/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`
- `pstack/automations/benny/skills/setup-benny/SKILL.md`
- `pstack/automations/benny/skills/triage-issue-reports/SKILL.md`
- `pstack/skills/automate-me/SKILL.md`
- `pstack/skills/benchmark-checklist/SKILL.md`
- `pstack/skills/blast-radius/SKILL.md`
- `pstack/skills/bro/SKILL.md`
- `pstack/skills/maintain-verification-skill/SKILL.md`
- `pstack/skills/make-bot-ui/SKILL.md`
- `pstack/skills/poteto-mode/SKILL.md`
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
- `pstack/skills/recall/SKILL.md`
- `pstack/skills/setup-pstack/SKILL.md`
- `pstack/skills/teach/SKILL.md`
- `pstack/skills/typescript-best-practices/SKILL.md`
- `pstack/skills/unslop/SKILL.md`

## Unresolved queue summary

- PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001: Exact host slash-menu spelling and autocomplete for each skill name remain unverified at runtime.
- PSTACK-CMD-PLUGIN-SKILLS-REGISTER-001: Whether agents are listed as slash commands or only as Task subagent_types is unresolved without a reference journey.
- PSTACK-CMD-DISABLE-MODEL-INVOCATION-001: Same frontmatter flag appears on every pstack SKILL.md in this lock; per-skill runtime enforcement still needs paired observation.
- PSTACK-CMD-DISABLE-MODEL-INVOCATION-001: Interaction with poteto-mode mode:true sticky attachment is a separate requirement already seeded elsewhere.
- PSTACK-CMD-HOW-SIMPLE-PATH-001: Complex-path explorer count (2 to 4) and model role lines need their own atomic requirements.
- PSTACK-CMD-SWARM-FANOUT-001: Cloud vs local environment selection and swarm workers model-role line need runtime pairing.
- PSTACK-CMD-SWARM-FANOUT-001: Exact N derivation rules when the user omits N remain open.
- PSTACK-CMD-ARENA-BASE-GRAFT-001: Default runner model pair and cross-judge panel behavior need separate requirements.
- PSTACK-CMD-ARENA-BASE-GRAFT-001: Worktree isolation mechanics need a dedicated requirement.
- PSTACK-CMD-ARCHITECT-GROUND-HOW-001: Greenfield skip of Phase A needs its own negative-path requirement.
- PSTACK-CMD-ARCHITECT-GROUND-HOW-001: Scrap-and-redesign when implementation proves the sketch wrong needs a separate requirement.
- PSTACK-CMD-INTERROGATE-NO-AUTOAPPLY-001: Configured interrogate reviewers panel size and model lines need runtime verification.
- PSTACK-CMD-INTERROGATE-NO-AUTOAPPLY-001: Intent paragraph gate before spawn needs its own atomic requirement.
- PSTACK-CMD-REFLECT-TRIGGER-001: Three parallel reviewer spawn and synthesizer routing need separate requirements.
- PSTACK-CMD-REFLECT-TRIGGER-001: Transcript layout variants (flat, nested, subagent) need paired observation.
- PSTACK-CMD-WHY-MOTIVATION-001: Parallel MCP evidence categories and null-result contract need their own requirements.
- PSTACK-CMD-WHY-MOTIVATION-001: Epistemics confidence language enforcement needs a separate requirement.
- PSTACK-CMD-POTETO-HELP-NO-WORK-001: Work-request messages that should redirect into poteto-mode need a separate requirement.
- PSTACK-CMD-POTETO-HELP-NO-WORK-001: Multiple-choice clarification options need UI observation.
- PSTACK-CMD-TDD-EXPLICIT-GATE-001: Exact fail-then-pass observation protocol across hosts needs paired journeys.
- PSTACK-CMD-CREATE-VERIFY-SKILL-001: Surface-specific harness recipes (browser/CDP vs PTY vs HTTP) need separate requirements.
- PSTACK-CMD-CREATE-VERIFY-SKILL-001: maintain-verification-skill upkeep loop is uncovered in this slice.
- PSTACK-CMD-SHOW-ME-YOUR-WORK-TSV-001: When to commit the log versus keep it local needs stake-based judgment criteria observed in reference runs.
- PSTACK-CMD-FIGURE-IT-OUT-PLAYBOOK-FIRST-001: Hypothesis-loop phase details and architect/arena gates inside the playbook need further atomic requirements.
- PSTACK-CMD-CORRECT-ENCODE-001: Rule table location and expiry exception format need a separate requirement.
- PSTACK-CMD-TECHNICAL-WRITING-DOCS-001: Per-layer checks need separate falsifiable requirements beyond entry-point activation.
- PSTACK-CMD-NO-COMMENTS-SICKO-001: Agent definition parity for pstack/agents/comment-sicko.md is uncovered in this slice.
- PSTACK-CMD-NO-COMMENTS-SICKO-001: Failure after a second rejected rerun needs a dedicated requirement.

## Gotchas

- Host slash-menu discoverability is inferred from skill `name` frontmatter and `plugin.json` registration. Runtime menu observation is still unresolved.
- Principle skills are discoverable inventory entry points but were left for a later slice so this one stays on user-facing slash workflows.
- Benny automation skills are in the topic inventory via `pstack/**/skills/**/SKILL.md` and remain uncovered here.
- Acceptance definitions stay DRAFT. No freeze. No status set to verified.
