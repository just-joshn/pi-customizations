# u-journey-setup-budget-apply report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair proves budget `large` remaps every real slug effort token to `xhigh` (panel list entries included) and leaves `auto` / `inherit-parent` unchanged. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `66de566f-5754-4e84-b3c2-2683254d419d` |
| pi | `bf23823c-fcb1-4d97-9367-6d15b7a66591` |

Pair. `parity/evidence/setup-budget-apply/pair-setup-budget-apply-large-1.json`

## Observed mapping

Both sides started at budget `small (medium)` with real medium-effort values, `bug-fix: auto`, and `how explorer: inherit-parent`. After choosing `large — xhigh reasoning`:

| Check | Cursor | Pi |
| --- | --- | --- |
| Budget after | large (xhigh) | large (xhigh) |
| Real entries remapped to xhigh | 19 / 19 | 19 / 19 |
| Panel list entries remapped | yes | yes |
| `bug-fix` stayed auto | yes | yes |
| `how explorer` stayed inherit-parent | yes | yes |
| Scorer pass | yes | yes |

Cursor after digest. `sha256:9e20c425d0af4c4df6b5fb7140e554a896ffcb236b4a9aaaee37f08e98c2ee6d`

Pi after digest. `sha256:d4fe44fb31719706d0fb66b147cc0b4352219fbc2dbfa1480fa9f581fe77f83d`

Digests differ because host slug formats differ. The mapping oracle matches.

## Commands run

1. Confirmed locked reference digest `sha256:2b6b4668…` on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote fixtures under `parity/evidence/setup-budget-apply/` and `parity/scripts/capture-setup-budget-apply.mjs`.
3. Ran `node parity/scripts/capture-setup-budget-apply.mjs --cursor-only`, then `--pi-only` (with retries noted below).
4. Re-read both `rule-before.mdc` / `rule-after.mdc` pairs and scorer output.
5. Restored locked rule digest after each side (verified `sha256:2b6b4668…` after the run).

## Host deltas and product gaps

1. **Slug format.** Cursor effort-in-slug (`claude-opus-5-5-xhigh`, `grok-4.7-xhigh-fast`) versus Pi `provider/id:effort` (`claude-subscription/claude-opus-5-5:xhigh`). Pair uses host-native fixtures with the same logical shape.
2. **Pi write tool does not remap.** `pstack_setup` write records role values as supplied (`setup-tool.test.ts` names this). The agent must pass remapped `roleOverrides`. Cursor writes the file directly from the skill.
3. **Pi availableModels vs skill-default Grok.** First Pi fixture used `xai/grok-4.7:medium`. Write rejected because `xai/grok-4.7` was not in `availableModels`. Retried with `claude-subscription` Claude models only.
4. **Cursor first attempt collapsed to inherit-parent.** Attempt `f9d28087-…` claimed the current rule was all aliases and only changed the budget line. Explicit remapped-table instruction on attempt `66de566f-…` produced the pass. Soft load-state failure under a short instruction is a product risk for Auto sessions.
5. **Harness race on Pi.** Write-card title can scroll off before settle. Capture script now polls the rule file / confirmation prose and snapshots before restore.

## Failed / discarded attempts

| Side | Attempt ID | Why discarded |
| --- | --- | --- |
| cursor | `f9d28087-8987-4534-865e-8f2051ee1e6c` | Collapsed real slugs to inherit-parent |
| pi | `09c6b499-8da4-4dd8-b519-9024b493e951` | Grok unavailable; no write |
| pi | `1920f5e5-6004-4195-9476-b2c658692852` | Write card showed remap; harness read locked digest |
| pi | `14a9cc18-ec55-4018-aadb-acbb4a0816cc` | Write succeeded; screen needle timed out before file poll fix |

## Scope not claimed

This pair proves `large → xhigh` on real slugs including panel lists, with aliases unchanged. It does not separately prove `unlimited → max`, `medium → high`, or `small → medium` in this journey. Coordinator can decide whether one label is enough for `PSTACK-SETUP-BUDGET-APPLY-001` or whether the other labels need their own pairs.

## Standing

Did not edit `requirements.json`, `mismatches.json`, or `progress.md`. Did not commit.
