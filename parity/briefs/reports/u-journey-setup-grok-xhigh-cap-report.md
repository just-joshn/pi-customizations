# u-journey-setup-grok-xhigh-cap report

## Status

**fail** for the linked pair. Cursor proves Grok stays at `xhigh` under budget `unlimited` (Claude goes to `max`, aliases unchanged). Pi mixed-Grok attempt did not write `unlimited` and left Grok at `:medium`. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Scorer |
| --- | --- | --- |
| cursor | `faeae5d9-c831-4b7b-9f47-abad3ed21433` | pass |
| pi | `c91e2ff6-2346-4d2c-93e7-932867963283` | fail |

Pair. `parity/evidence/setup-grok-xhigh-cap/pair-setup-grok-xhigh-cap-1.json`

## Cursor observations (measured)

Started at budget `small (medium)` with mixed Grok + Claude real slugs, `bug-fix: auto`, `how explorer: inherit-parent`. After choosing unlimited:

| Check | Result |
| --- | --- |
| Budget after | unlimited (max) |
| Grok entries at xhigh | 10 / 10 (`grok-4.7-xhigh-fast`, panel lists included) |
| Grok at max | none |
| Non-Grok Claude at max | 9 / 9 |
| `bug-fix` stayed auto | yes |
| `how explorer` stayed inherit-parent | yes |
| After digest | `sha256:81d8f8a6a6c730b190773c3eefe209e78bc4c20d8fbe18e0a2a2d7a5216180e7` |

Re-read `parity/evidence/setup-grok-xhigh-cap/cursor/rule-after.mdc` for those tokens. Locked reference digest restored after the side.

## Pi observations (measured)

Fixture `fixture-pi.mdc` includes `xai/grok-4.7:medium`. Role-confirm UI listed those Grok lines. Linked attempt `c91e2ff6` never wrote `# budget: unlimited (max)`. `rule-after.mdc` digest equals the fixture (`sha256:b8f73977…`). Scorer fail.

## Commands run

1. Confirmed locked digest `sha256:2b6b4668…` on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote `parity/scripts/capture-setup-grok-xhigh-cap.mjs` plus fixtures under `parity/evidence/setup-grok-xhigh-cap/`.
3. Serialized via `pstack-models.mdc.parity-lock`. Ran `--cursor-only`, then `--pi-only --pi-fixture=mixed`.
4. Re-read both `rule-before.mdc` / `rule-after.mdc` pairs and scorer fields.
5. Restored locked digest after each side (verified `sha256:2b6b4668…` at report time on both host rule paths).

## Honest gaps

1. **Pi did not complete unlimited remap.** Pair verdict is fail. Cursor alone proves the Grok xhigh cap for this requirement’s Cursor host path.
2. **No xai auth in `/tmp/pi-ref-agent/auth.json`.** Grok is in `models-store.json` but not authenticated. Prior budget-apply notes the same `availableModels` wall for `xai/grok-*` writes.
3. **Harness false write on Pi.** Instruction text containing “Remap” matched an early needle. Script now requires `Edited pstack-models.mdc` or a real `# budget: unlimited (` file change.
4. **Cursor selector label.** Still `unlimited — keep max` vs official `unlimited — max reasoning`.
5. **Soft load-state on first Cursor try.** Attempt `f3a370da` claimed all inherit-parent despite a mixed Grok fixture. Retry with forced re-read passed.

## Failed / discarded attempts

| Side | Attempt ID | Why discarded |
| --- | --- | --- |
| cursor | `f3a370da-5650-4fd8-a06d-9f1185c6b88b` | Soft load-state + long paste stuck |
| cursor | `fa446220-8d97-493d-a7ad-3043099919e0` | Chat-form needle missed `reply with one label` |
| pi | `5a21ed3f-e8c0-4744-8e1d-bd73287f8f0a` | AskQuestion Other never selected |
| pi | `8e82b1c5-2256-4efa-80b6-952f648e62dc` | Role-confirm Other overshot |
| pi | `449127cb-1763-4893-9812-c70ce3b7defd` | Space-without-type on Other |
| pi | `4564da87-5ea1-4380-9211-3ec91b86bd3a` | Type-without-Space stuck on budget Other |

## Scope not claimed

Does not close `PSTACK-SETUP-GROK-XHIGH-CAP-001` in ledgers. Coordinator owns merge. Pi Grok-under-unlimited remains open until a write with a detected Grok slug lands.

## Standing

Did not edit `requirements.json`, `mismatches.json`, or `progress.md`. Did not commit.
