# u-make-bot-automations-editor-001 report

**status.** Cursor Automations webhook create path proven via `/automate` handoff. Key-server end-to-end on Cursor still unpaid. Ledgers untouched.

throughput checkpoint: n/a, read-only investigation

## Verdict

| Field | Value |
| --- | --- |
| setStatusResolved | **no** |
| canCloseMismatch | **no** |
| mismatch | MAKE-BOT-UI-KEY-SERVER-HOST |
| requirement | PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001 |

## Overview

Make Bot UI on Cursor no longer depends on inventing `update_state`. The Automations product accepts an incoming HTTP webhook trigger through the Agents Window `/automate` skill, opens the editor with that trigger, and shows a webhook URL plus a Generate auth header control. Pi half `e75f8e08` stays `key_server_ok`. Cursor still lacks a completed key-server probe after auth generation.

## Key concepts

- **Automations webhook trigger.** Documented in `~/.cursor/skills-cursor/automate/SKILL.md` as proto key `webhook`. Prefill is `webhook: {}`. URL and auth are finished in the editor.
- **Make Bot UI skill path.** Still names `update_state` routine create and `secret-request`. That path remains missing on Cursor PTY and the Actions palette.
- **Auth boundary.** Editor control is Generate auth header. This unit did not click it. No sender key appeared in chat or AX evidence.

## How it works

1. Agents Window runs `/automate` with an explicit webhook-only draft.
2. Draft table lists Trigger as Incoming HTTP webhook.
3. Finish handoff opens Automations editor with Webhook triggered, a `api2.cursor.sh/automations/webhook/<id>` URL, and Generate auth header.
4. Harness stops before Save and Activate.

Manual Add Trigger combo clicks (helper, System Events, AXShowMenu, set_value) never exposed picker options in AX. Product create works through `/automate` prefill, not through opening that empty combo under automation.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-make-bot-automations-editor-001-report.md` |
| Disposition | `parity/research/make-bot-automations-editor-001/disposition.json` |
| Webhook handoff evidence | `parity/evidence/setup-benny/creation-boundary/agents-window/c345b7ed-5c24-424c-86c3-55211b7bf0c8/` |
| Copied markers | `parity/evidence/make-bot-ui/automations-editor/c345b7ed-5c24-424c-86c3-55211b7bf0c8/` |
| Trigger picker negatives | `parity/evidence/make-bot-ui/automations-editor/8ff6b213-1dbf-4d47-8cec-6671d5ec9cc7/` |
| Blocker artifact | `parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json` |
| Lever | `parity/scripts/capture-automations-desktop-agents-window.py` (`automate-handoff webhook-witness`) |

## Attempt IDs

| Label | ID | Result |
| --- | --- | --- |
| `/automate` webhook handoff | `c345b7ed-5c24-424c-86c3-55211b7bf0c8` | Draft Incoming HTTP webhook. Editor Webhook triggered + URL + Generate auth header. Save/Activate not pressed. |
| Add Trigger exhaustive negative | `8ff6b213-1dbf-4d47-8cec-6671d5ec9cc7` | Combo hit; no webhook/schedule options in AX after ShowMenu/set_value/keys. |
| Prior editor URL chrome | `f6e29fb7-5878-4c8c-841e-1538b39d1cf7` | Editor reachable (reused). |
| Prior schedule handoff | `b60a705b-e2ea-40c4-adeb-7014fde433b4` | Schedule witness (reused). |
| Pi key_server_ok | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` | Unchanged. |
| Cursor PTY | `bb50ed1b-29ac-4961-bb0a-5c2ffd9834b2` | Still host_blocked for update_state. |

## Leak scan

Scanned webhook handoff AX for Bearer / X-Automation-Key / long token shapes. No sender key values found. Only the Generate auth header button label matched a loose scan. URL host `api2.cursor.sh` is allowed to appear (skill permits pasting the webhook URL).

## Forbidden checks

| Gate | Held |
| --- | --- |
| No ledger edits | yes |
| No invented update_state success | yes |
| No sender keys in report/evidence bodies | yes |
| No further subagents | yes |
| No spending / Save / Activate by harness | yes |

## Gotchas

- `/automate` can open a webhook draft that already shows a webhook URL before the harness presses Save. Auth generation is a separate control.
- AXShowMenu on Add Trigger opens Chrome's context menu (Inspect), not the product trigger list.
- Make Bot UI and Automations webhook auth are different mechanisms. Do not equate Generate auth header with secret-request without a measured card.

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| setStatusResolved | no |
| canCloseMismatch | no |
| Recommended ledger action | keep MAKE-BOT-UI-KEY-SERVER-HOST open; note Cursor webhook Automations path `c345b7ed`; next unit = Generate auth header + server store + probe without leaking keys |
| Pi half | keep `e75f8e08` |
| Ledger edits by this unit | none |

## Attention

reviewed by poteto-agent under brief (no further subagents)

- Operator may discard Inactive drafts from `/automations/new` probes and Inactive `parity-webhook-witness` if unwanted. Do not Save to discard.
