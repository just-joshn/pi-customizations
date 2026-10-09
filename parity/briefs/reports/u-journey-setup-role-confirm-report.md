# u-journey-setup-role-confirm report

## Status

**fail** for `PSTACK-SETUP-ROLE-CONFIRM-001` paired parity. Linked Cursor+Pi pair captured on real PTY at the locked fixture. Cursor shows every role with its model and asks accept/change before write. Pi asks accept/change before write but summarizes all 17 roles as inherit-parent instead of listing each role with its model. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `b72b2ad5-c36a-4219-81ba-04954cb9888c` |
| pi | `08ab0e09-4a60-4b44-836e-01ca750bb534` |

Pair. `parity/evidence/setup-role-confirm/pair-setup-role-confirm-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

## Observed journey

Both sides ran `/setup-pstack` on the locked all-inherit-parent rule, answered budget keep-small, dumped the role-confirm screen, then accepted.

### Role table / confirm

| Check | Cursor | Pi |
| --- | --- | --- |
| Roles listed with model | 17/17 (Role/Model table) | 0/17 |
| Accept/change prompt before write | yes (chat form) | yes (AskQuestion) |
| Digest changed before accept | no | no |
| `Edited pstack-models.mdc` after accept | yes (`+0 -0`) | yes (`+0 -0`) |
| Final rule digest | locked (unchanged) | locked (unchanged) |

Cursor confirm screen (`screen-02-role-confirm.txt`) paints a full table of all 17 roles with `inherit-parent`, states dropped retired roles as none, and asks "Accept as-is, or name roles to change?" with detected slugs plus inherit-parent and auto.

Pi confirm screen asks "All 17 roles are currently inherit-parent (no dropped lines). Accept as-is?" with options Accept as-is / Change specific roles / Other. No per-role listing appears on that panel.

### Write ordering

Rule digest stayed at the locked fixture through budget answer and through the confirm screen on both sides. The edit card appeared only after accept. Accept-as-is left bytes unchanged (`wroteBytesChanged: false`), which still satisfies "no write before confirmation completes."

## Commands run

1. Confirmed locked reference digest on both host rule paths.
2. Wrote `parity/scripts/capture-setup-role-confirm.mjs`.
3. Ran `--cursor-only` (linked attempt `b72b2ad5-…`), then `--pi-only` (linked attempt `08ab0e09-…`).
4. Re-read confirm and write-card screens, role-confirm scores, identities, and restored digests.
5. Wrote `pair-setup-role-confirm-1.json`.

## Host deltas and product gaps

1. **Pi does not show every role with its model before confirm.** It summarizes. That fails the expected observation for `PSTACK-SETUP-ROLE-CONFIRM-001` on the candidate host.
2. **Cursor meets the role-table observation** via a markdown table in chat, not AskQuestion. AskQuestion is preferred by the skill; chat form still asked accept/change with model options listed in prose.
3. **Pi AskQuestion path** matches the preferred confirm UI shape, but collapses the working table into one sentence.
4. Pi write-card transcript included a transient `Unknown budget 'small (medium)'` line before the zero-diff edit card. Digest stayed locked.
5. Discarded earlier attempts (scorer/table truncation, budget needle miss, Pi Other navigation) are listed in the pair JSON. Not used as evidence.
6. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
7. Did not commit.

## Suggested follow-ups for the coordinator

1. Record a mismatch or Pi binding for role-confirm listing. Cursor table vs Pi summary is the concrete gap.
2. Decide whether Cursor chat-form confirm (with full table) counts as AskQuestion-preferred satisfaction for the reference side, or whether reference must use Clarifying Questions too.
3. Optional. Re-capture Pi after product change that prints the working role table in the confirm question body.
