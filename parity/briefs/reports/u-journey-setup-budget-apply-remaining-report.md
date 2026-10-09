# u-journey-setup-budget-apply-remaining report

## Status

**pass** for the three remaining budget labels on the capture brief. Linked Cursor+Pi pairs prove `medium → high`, `small → medium`, and `unlimited → max` on real slugs (panel lists included) with `auto` / `inherit-parent` unchanged. Ledgers untouched. No commit. Does not claim `PSTACK-SETUP-BUDGET-APPLY-001` verified (coordinator merges).

## Pass/fail per label

| Label | Effort | Verdict | Cursor attempt | Pi attempt | Pair |
| --- | --- | --- | --- | --- | --- |
| medium | high | pass | `be8f0188-2a3c-4dfa-8eca-3c2f93879f7d` | `47fd52de-8fc7-4fc8-814f-93fadbfda71a` | `parity/evidence/setup-budget-apply/pair-setup-budget-apply-medium-1.json` |
| small | medium | pass | `cc8d4964-b8dd-4727-9ccc-59028ce8278a` | `054f0df3-dd70-4eda-b612-02ed91da6e62` | `parity/evidence/setup-budget-apply/pair-setup-budget-apply-small-1.json` |
| unlimited | max | pass | `f1a6ea10-e71e-4edf-806b-b246331fef0f` | `b6d37ee7-3912-48f0-988a-e4f6e5de23ed` | `parity/evidence/setup-budget-apply/pair-setup-budget-apply-unlimited-1.json` |

Prior large pair unchanged. `parity/evidence/setup-budget-apply/pair-setup-budget-apply-large-1.json`

## Scorer checks (both sides, each label)

| Check | medium | small | unlimited |
| --- | --- | --- | --- |
| Budget after | medium (high) | small (medium) | unlimited (max) |
| Real entries remapped | 19 / 19 | 19 / 19 | 19 / 19 |
| Panel list entries remapped | yes | yes | yes |
| `bug-fix` stayed auto | yes | yes | yes |
| `how explorer` stayed inherit-parent | yes | yes | yes |

## Fixtures

| Label | Cursor fixture | Pi fixture | Start effort |
| --- | --- | --- | --- |
| medium | `fixture-cursor.mdc` | `fixture-pi.mdc` | medium |
| small | `fixture-cursor-high.mdc` | `fixture-pi-high.mdc` | high |
| unlimited | `fixture-cursor-claude-medium.mdc` | `fixture-pi.mdc` | medium (Claude-only on Cursor) |

## Commands run

1. Extended `parity/scripts/capture-setup-budget-apply.mjs` with `--budget=medium|small|unlimited|large` and matching `--effort=high|medium|max|xhigh`. Default remains large / xhigh.
2. Confirmed locked digest `sha256:2b6b4668…` before and after each side.
3. Serialized Cursor captures. Ran `--cursor-only` then `--pi-only` per label.
4. Re-read pair `rule-after.mdc` files and scorer fields. Locked digest still `sha256:2b6b4668…` at report time.

## Host deltas and honest gaps

1. **Slug format.** Cursor effort-in-slug versus Pi `provider/id:effort`. Digests differ; mapping oracle matches.
2. **Pi write tool does not remap.** Agent must pass remapped `roleOverrides`.
3. **Cursor chat-form needle drift.** Prompt now says `Reply with one of those labels` (not `four labels`). First medium Cursor attempt timed out on the old needle (`2552b45b-6526-4307-99dd-b7173b3c6bd9`). Script updated.
4. **Early `Pick a budget:` match.** Matching that string mid-Working raced the free-text reply. Script now waits for Reply needles and spinner clear.
5. **Unlimited selector label.** Cursor still shows `unlimited — keep max` (known mismatch vs `unlimited — max reasoning`). Instruction accepted that option and wrote `# budget: unlimited (max)`.
6. **Grok under unlimited.** Skill tops Grok at `xhigh`, so a mixed Grok Cursor fixture cannot pass an all-to-max oracle. Unlimited Cursor pair used a Claude-only fixture. Pi already used claude-subscription Claude models.
7. **`--pi-only` overwrote capture-results.** Single-side runs now merge prior opposite-side results into `capture-results-{budget}.json`.

## Failed / discarded attempts

| Side | Attempt ID | Label | Why discarded |
| --- | --- | --- | --- |
| cursor | `2552b45b-6526-4307-99dd-b7173b3c6bd9` | medium | Chat-form needle still expected `four labels` |
| cursor | `ddb6e126-6f20-448a-b183-1c5084acca6b` | unlimited | Matched `Pick a budget:` while Working; no write before timeout. Retried with Claude fixture + settle wait (`f1a6ea10-…`) |

## Scope not claimed

Pairs prove the three remaining labels under the fixtures above. Coordinator still owns ledger merge and whether `PSTACK-SETUP-BUDGET-APPLY-001` is verified-pass-paired. Grok-under-unlimited fallback remains a separate observation (Claude-only unlimited Cursor fixture).

## Standing

Did not edit `requirements.json`, `mismatches.json`, or `progress.md`. Did not commit.
