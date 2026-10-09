# u-journey-setup-alias-validate report

**status.** done  
**verdict.** pass  
**pair.** `parity/evidence/setup-alias-validate/pair-setup-alias-validate-1.json`

## Summary

One linked Cursor+Pi pair covers both oracles. Each host refused to write `parity-unavailable-model-zzz`, re-asked for a valid `bug-fix` value, and treated `inherit-parent` / `auto` as always-valid aliases. Detected model lists came from live screens only.

## Attempt IDs

| Host | attemptId |
| --- | --- |
| Cursor | `441393b8-841f-4c85-8c9e-3589b4d889c4` |
| Pi | `926d4a3d-7f9c-47ae-b237-cf2b83e0b3ad` |

Pair path: `parity/evidence/setup-alias-validate/pair-setup-alias-validate-1.json`

## Oracle observations

### PSTACK-SETUP-ALIAS-ALWAYS-VALID-001

Cursor screen-10 states `Aliases that always pass: inherit-parent, auto` and holds `feature, refactoring: inherit-parent` plus `perf-issue: auto` without writing the unavailable slug. Pi re-ask panels offer `inherit-parent` and `auto` beside detected provider/id values after rejecting the unavailable slug.

### PSTACK-SETUP-VALIDATE-001

Cursor screen-10. `Stopped — no write. parity-unavailable-model-zzz is not in the detected set for this session.` Then re-asks for a detected slug or alias.

Pi screen-09 / screen-10. `The slug parity-unavailable-model-zzz isn't in the detected set, so I'm not writing the rule.` Clarifying question repeats that nothing was written and asks for a valid `bug-fix` value.

Neither side persisted `parity-unavailable-model-zzz` in `rule-after.mdc`.

## Detected sets (from screens, not invented)

Cursor listed bare Task slugs on screen-01 / screen-10, including `claude-opus-5-5-medium`, `composer-2.5-fast`, `grok-4.7-high`, and others on that screen.

Pi’s re-ask offered at least `claude-subscription/claude-opus-5-5` and `openai/gpt-5.5` as exact provider/id choices.

## Host deltas

1. Cursor drove budget/roles through chat-form free text. Pi used AskQuestion panels.
2. Cursor detection uses bare slugs. Pi’s validate/re-ask path uses `provider/id`.
3. Cursor enforcement for this journey is skill-prompted. Pi also has tool-level `Unavailable model` rejection in `pstack_setup` write; this capture stopped at the skill/AskQuestion layer before a write card on both hosts.
4. Concurrent setup workers share `~/.cursor/rules/pstack-models.mdc`. The mixed `auto` fixture bytes were not always the on-disk state the agent read. Screen text is the primary oracle for this pair.

## Honest product gaps

1. No paired write-card path in this capture. The validate negative branch intentionally stops before write. Happy-path “every real slug written is in the detected set” after a successful write is not re-proven here; it relies on prior setup-success / setup-rerun pairs for alias-only tables.
2. Cursor still lacks a `pstack_setup`-style atomic validate+write tool. Parity for VALIDATE-001 on Cursor depends on the model following the skill. Pi can hard-fail at the tool boundary.
3. Shared reference-rule path remains a capture hazard under parallel setup journeys.

## Artifacts

- Lever: `parity/scripts/capture-setup-alias-validate.mjs`
- Evidence root: `parity/evidence/setup-alias-validate/`
- Pair: `parity/evidence/setup-alias-validate/pair-setup-alias-validate-1.json`
- Audit: `parity/evidence/setup-alias-validate/.audit/u-journey-setup-alias-validate.tsv`
- Playbook: `parity/evidence/setup-alias-validate/PLAYBOOK.md`
