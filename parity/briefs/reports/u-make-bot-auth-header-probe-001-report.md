# u-make-bot-auth-header-probe-001 report

**status.** Cursor `key_server_ok` not reached. Honest blocker. Ledgers untouched.

throughput checkpoint: auth-header probe stopped on unreachable Generate control after broken webhook prefill handoff

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

The goal was to click Generate auth header on the proven webhook Automations path, keep the sender key only in an owned 0600 server path, and probe HTTP 200. This session could not re-enter a live webhook editor that shows Generate auth header. The `/automate` handoff now lands on Untitled New Automation with a prefill parse error. No sender key was generated, stored, or leaked.

## What we measured

1. Prior path `c345b7ed` still stands as the Generate auth header witness (Save/Activate not pressed then).
2. Fresh webhook-witness handoffs (`e0675dab`, `beb9d748`) needed more than one readiness `yes` (draft approve, then open editor). The harness was patched for multi-yes.
3. Product chat text said webhook URL and auth appear only after Save. Brief allows Save for that reason.
4. Live editor chrome showed Automations > New Automation, Untitled, Add Trigger, and OCR `Could not parse automation prefill from URL`. No `api2.cursor.sh` webhook URL. No Generate auth header.
5. Save on that broken Untitled surface (`b0e3b61a`) did not materialize Generate or a webhook URL. Unsaved Changes stayed up.
6. Automations list shows `parity-webhook-witness` in OCR, but AX only exposes wide activity-feed buttons. Clicking those does not open the webhook editor.
7. Cursor dropped to zero windows mid-run once. Windows were restored via File > New Window. Control continued after recovery.
8. Pi half `e75f8e08` remains `key_server_ok`. No `update_state` invented.

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Prior webhook handoff (Generate visible) | `c345b7ed-5c24-424c-86c3-55211b7bf0c8` | Reused witness only |
| Handoff multi-yes / prefill broken | `beb9d748-5985-4d4c-a2ee-ca1224fe9a84` | Add Trigger chrome without webhook URL/Generate |
| Save on broken Untitled | `b0e3b61a-977f-41e4-8fda-8a29c77b34a3` | Save pressed; Generate still absent |
| OCR open existing draft | `93b7d145-bdb3-47bc-b545-fd618ea50e52` | Stuck on New Automation; list row miss |
| List/activity-feed click miss | `5b9388e6-59e2-46cd-947d-2d31c8c2cf2c` | Clicked feed row; editor not webhook |
| Wrong-editor handoff | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | Opened benny-triage chrome |
| Pi key_server_ok | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` | Unchanged |

## Leak scan

Scanned `parity/research/make-bot-auth-header-probe-001/` and `parity/evidence/make-bot-ui/auth-header-probe/` text artifacts. No Bearer / X-Automation-Key values and no long token bodies. No sender key written to the owned server store this unit.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits | yes |
| No invented update_state | yes |
| No sender keys in report/evidence bodies | yes |
| No further subagents | yes |
| No Activate | yes |
| Save only for auth materialization attempt | yes (on broken Untitled; did not help) |

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| setStatusResolved | no |
| canCloseMismatch | no |
| Recommended ledger action | keep MAKE-BOT-UI-KEY-SERVER-HOST open; Cursor still unpaid for Generate + 0600 store + probe 200 |
| Pi half | keep `e75f8e08` |
| Ledger edits by this unit | none |

## Attention

reviewed by poteto-agent under brief (no further subagents; no separate cross-model trail reviewer)

- Operator may need to discard the stuck Untitled New Automation and open `parity-webhook-witness` manually once. Prefill parse error blocked automation.
- Owned server dir `~/.local/share/pi-pstack-parity/make-bot-auth-header-probe-001/` has no key from this unit.
