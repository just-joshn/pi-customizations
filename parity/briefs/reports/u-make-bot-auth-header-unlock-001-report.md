# u-make-bot-auth-header-unlock-001 report

**status.** Cursor `key_server_ok` not reached after claimed display unlock. Honest blocker. Console still locked for input. Ledgers untouched.

throughput checkpoint: unlock brief cannot Discard stuck Untitled or reach Generate while `IOConsoleLocked=Yes`

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

The brief asked to discard stuck Untitled if present, open a live webhook Automations editor, click Generate auth header, store the sender key only under an owned 0600 path, and probe HTTP 200. The Mac console remained locked (`IOConsoleLocked=Yes`, `loginwindow` at layer 2004). Helper reported `isActive=false`. System Events `click at` landed on loginwindow "show all users", not Cursor. Live window capture still showed Automations > New Automation Untitled with an Unsaved Changes modal (Discard / Keep Editing / Save). No `parity-webhook-witness`, no Generate auth header, no sender key stored or leaked.

## What we measured

1. Adapted unlock lever from the retry probe. Prefer element_index and System Events click-at / AXPress. No helper xy as primary path.
2. Attempt `2bcf48b9` raised Agents Window via palette, saw Untitled + Unsaved modal in OCR, never opened Generate. Prefill parse error was absent this run. Fallback `/automate` handoff sent the unlock token prompt but yesSentCount stayed 0 under the modal. Outcome initially `untitled_new_automation_without_generate`.
3. Helper screenshots during that attempt were bit-identical across polls (frozen share buffer hash `149f7d56d2079371`). System `screencapture -l` of Cursor Agents differed and confirmed the same stuck modal live.
4. Discard diagnose. System Events AXPress Discard returned false (Cursor windows count 0). AX had zero Discard buttons. OCR SE click-at claimed a click but the modal stayed.
5. Lock census. `ioreg` `IOConsoleLocked=Yes`. `loginwindow` overlays at layer 2004. SE click at Discard screen coords returned loginwindow Login UI. Helper xy still rejected with frontmost requirement. CGEvent posts did not clear the modal.
6. Owned secret dir `~/.local/share/pi-pstack-parity/make-bot-auth-header-unlock-001/` was never created. No key files.
7. Pi half `e75f8e08` remains `key_server_ok`. No `update_state` invented. No Activate. No Save.

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| Unlock probe | `2bcf48b9-64ec-4ca4-8efb-22bda300ac5c` | Untitled + Unsaved modal; no Generate |
| Discard diagnose | `diagnose-discard-001` | SE/index/OCR Discard failed; isActive false |
| Syscap / lock census | `diagnose-syscap-001` | Live Agents OCR + IOConsoleLocked + loginwindow click target |
| Prior Generate-visible witness | `c345b7ed-5c24-424c-86c3-55211b7bf0c8` | History only |
| Prior blocked reentry | `beb9d748-5985-4d4c-a2ee-ca1224fe9a84` | History |
| Prior retry blocker | `67bfeab7-7da4-41fa-b086-34203c4ee7e9` | History |
| Prior screen-locked | `fdd603d5-ab1e-4b75-89a1-fa8165b18b51` | Same class of lock |
| Pi key_server_ok | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` | Unchanged |

## Leak scan

Scanned `parity/research/make-bot-auth-header-unlock-001/` and `parity/evidence/make-bot-ui/auth-header-unlock/` text artifacts. No Bearer / X-Automation-Key sender values. Grep long-token hits were path strings and lever regex source only. No sender key written to the owned server store.

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits | yes |
| No invented update_state | yes |
| No sender keys in report/evidence bodies | yes |
| No further subagents | yes |
| No Activate | yes |
| Save only if required for auth materialization | yes (Save never pressed; Discard only) |

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| setStatusResolved | no |
| canCloseMismatch | no |
| Recommended ledger action | keep MAKE-BOT-UI-KEY-SERVER-HOST open; Cursor unpaid until console unlock allows Discard + Generate + 0600 store + probe 200 |
| Pi half | keep `e75f8e08` |
| Ledger edits by this unit | none |

## Operator notes

1. Unlock the Mac console until `IOConsoleLocked` is No and System Events clicks hit Cursor, not loginwindow.
2. Then Discard the stuck Untitled New Automation (never Save).
3. Open `parity-webhook-witness`, Generate auth header, store under the owned 0600 path, probe for HTTP 200.

## Attention

reviewed by poteto-agent under brief (no further subagents; no separate cross-model trail reviewer)

- Claimed display unlock did not clear console lock for synthetic input.
- Helper freeze plus SE windows=0 are symptoms of the same lock, not separate product bugs to fix inside this unit.
- Owned server dir has no key from this unit.
