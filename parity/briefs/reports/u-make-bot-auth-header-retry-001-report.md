# u-make-bot-auth-header-retry-001 report

**status.** Cursor `key_server_ok` not reached after TCC terminal restart. Honest blocker. Ledgers untouched.

throughput checkpoint: post-TCC retry still cannot leave stuck Untitled New Automation or open `parity-webhook-witness` for Generate

## Verdict

| Field | Value |
| --- | --- |
| setStatusResolved | no |
| canCloseMismatch | no |
| mismatch | MAKE-BOT-UI-KEY-SERVER-HOST |
| requirement | PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001 |
| Cursor outcome | host_blocked |
| Pi half | key_server_ok (`e75f8e08`) unchanged |

## Overview

The brief asked to reopen a live webhook Automations editor (prefer existing `parity-webhook-witness`), click Generate auth header, store the sender key only under an owned 0600 path, and probe HTTP 200. After the TCC terminal restart, Cursor Agent Helper could screenshot again, but the product stayed on Automations > New Automation Untitled. Prefill parse error was still present on the formal probe attempts. List OCR never showed `parity-webhook-witness`. No sender key was generated, stored, or leaked.

## What we measured

1. Helper smoke after restart returned Cursor Agents AX + screenshot (`get_app_state` ok).
2. Attempt `cfb6dd2b` opened Automations still on Untitled with OCR `Could not parse automation prefill from URL` and an Unsaved Changes modal. AX Discard did not clear it. Handoff polls stayed on that surface until a late screenshot gap crashed the harness at poll 27.
3. Attempt `67bfeab7` added OCR Discard targeting and multi-yes handoff. Outcome `prefill_parse_error_blocks_webhook_editor`. `yesSentCount` reached 3. Editor never showed Generate auth header or an `api2.cursor.sh` webhook URL.
4. Follow-up diagnostics found helper synthetic xy clicks rejected with "require the app to be frontmost" even while System Events reported Cursor frontmost. System Events clicks could land. Unsaved modal eventually cleared in a later diagnose pass, but Untitled New Automation remained. Cmd+W, sidebar Automations, Open Automations palette, and File > New Window did not surface `parity-webhook-witness` in OCR.
5. Owned secret dir `~/.local/share/pi-pstack-parity/make-bot-auth-header-retry-001/` has no key files from this unit.
6. Pi half `e75f8e08` remains `key_server_ok`. No `update_state` invented. Prior Generate-visible witness `c345b7ed` and blocked reentry `beb9d748` unchanged as history.

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Prior Generate-visible witness | `c345b7ed-5c24-424c-86c3-55211b7bf0c8` | Reused witness only |
| Prior blocked reentry | `beb9d748-5985-4d4c-a2ee-ca1224fe9a84` | Historical |
| Retry attempt 1 (crash) | `cfb6dd2b-fced-47e0-a71f-948502bc0e96` | Untitled + prefill + Unsaved; screenshot gap at poll 27 |
| Retry attempt 2 (blocker) | `67bfeab7-7da4-41fa-b086-34203c4ee7e9` | `host_blocked` / `prefill_parse_error_blocks_webhook_editor` |
| Pi key_server_ok | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` | Unchanged |

## Leak scan

Scanned `parity/research/make-bot-auth-header-retry-001/` and `parity/evidence/make-bot-ui/auth-header-retry/` text artifacts. No Bearer / X-Automation-Key sender values. Grep hits were lever source strings, UUIDs, and traceback paths only. No sender key written to the owned server store.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits | yes |
| No invented update_state | yes |
| No sender keys in report/evidence bodies | yes |
| No further subagents | yes |
| No Activate | yes |
| Save only if required for auth materialization | yes (Save not pressed; Discard attempted only) |

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| setStatusResolved | no |
| canCloseMismatch | no |
| Recommended ledger action | keep MAKE-BOT-UI-KEY-SERVER-HOST open; Cursor still unpaid for Generate + 0600 store + probe 200 after TCC retry |
| Pi half | keep `e75f8e08` |
| Ledger edits by this unit | none |

## Attention

reviewed by poteto-agent under brief (no further subagents; no separate cross-model trail reviewer)

- Operator still needs a human discard of stuck Untitled New Automation and a manual open of `parity-webhook-witness` (or a fixed /automate webhook prefill). Automated list reopen remains unpaid under OCR and helper click constraints.
- Helper xy synthetic clicks appear broken post-TCC even when Cursor is frontmost. Prefer element_index or System Events until that recovers.
- Owned server dir has no key from this unit.
