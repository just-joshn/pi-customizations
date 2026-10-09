# u-setup-role-confirm-listing report

## Status

**pass** for SETUP-ROLE-CONFIRM-LISTING / `PSTACK-SETUP-ROLE-CONFIRM-001` paired role listing. Pi AskQuestion now lists all 17 roles with their models before accept. Cursor reuse remains green. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `b72b2ad5-c36a-4219-81ba-04954cb9888c` (reused; fixture unchanged) |
| pi | `f9259bfa-d306-4b5b-8ea4-c4d0de00b6fb` |

Pair path. `parity/evidence/setup-role-confirm/pair-setup-role-confirm-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

## What was broken

Pi role confirm collapsed the working table into one AskQuestion sentence ("All 17 roles are currently inherit-parent"). Scorer recorded `rolesListedWithModel: 0` and `everyRoleShownWithModel: false` on attempt `08ab0e09-…`. Cursor already showed 17/17 Role/Model rows.

## Root cause

Soft skill text ("Show every role with its model") lost to model summarization when every value was `inherit-parent`. AskQuestion prompt wrapping also flattened newlines, so a pasted listing would break across box borders.

## Fix

1. `pstack_setup` state returns `roleConfirmPrompt` with one `role: model` line per role, dropped lines, and Accept/Change wording.
2. Generated `setup-pstack` skill requires pasting that string verbatim into AskQuestion (resource transform in `scripts/resources.mjs`).
3. AskQuestion panel `wrap` preserves newline paragraphs so each role line stays intact on screen.
4. Capture scorer recognizes the observed summary phrasing; geometry rows raised to 64 so the listing fits.

## Verification

| Check | Cursor `b72b2ad5` | Pi `f9259bfa` |
| --- | --- | --- |
| `rolesListedWithModel` | 17/17 | 17/17 |
| `everyRoleShownWithModel` | true | true |
| `summaryOnly` | false | false |
| Accept/change before write | yes | yes |
| Digest before accept | locked | locked |
| Write card after accept | yes (`+0 -0`) | yes (`+0 -0`) |

Pi `screen-02-role-confirm.txt` shows `Current roles (one line per role; do not summarize):` followed by all 17 `role: inherit-parent` lines, then Accept as-is / Change specific roles.

Product regression tests. `test/setup-tool.test.ts`, `test/questions-panel.test.ts`, `test/skills-parity.test.ts`, `test/helpers/overlays.test.ts`, `test/resources.test.ts` all passed (52). Full package suite still has 2 pre-existing failures unrelated to this change (`parity-generator-playbooks` Cursor noun in poteto-help; `cli` / `verify-journeys` poteto-mode injection).

## Remaining gaps

1. Coordinator should close SETUP-ROLE-CONFIRM-LISTING and mark `PSTACK-SETUP-ROLE-CONFIRM-001` verified-pass-paired in ledgers (worker must not edit ledgers).
2. Product change is uncommitted per brief. Coordinator owns commit when ready.
3. Cursor still uses chat-form table rather than AskQuestion. Listing parity holds; UI shape still differs.
4. Pre-existing package suite failures above are outside this brief.

## Commands run

1. Reproduced from sealed pair + Pi screen-02 (`08ab0e09`).
2. Implemented tool/skill/wrap fix; regenerated setup-pstack skill via `node scripts/resources.mjs --write`.
3. Ran product-scoped vitest; ran `parity/scripts/capture-setup-role-confirm.mjs --pi-only`.
4. Linked pair JSON; restored locked fixture digest on both rule paths.
