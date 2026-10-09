# u-automations-desktop-001 report

**status.** honest blockers updated. Desktop Agents Window reached Automations list and skill chrome for both probes. Neither Cursor half closes. Pi make-bot half kept `e75f8e08`. Ledgers untouched. No commit.

throughput checkpoint: desktop Ready → Benny Automations path → make-bot webhook path → pair/blocker update → report

## Exit condition

Both mismatches have either a Cursor success attempt that closes the half, or an honest measured blocker with screens. Predicate met via honest blockers.

## Verdict

| Mismatch / requirement | Merge? | Cursor half close? | Why |
| --- | --- | --- | --- |
| SETUP-BENNY-CREATION-BOUNDARY-ENV / PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001 | **no** | **no** | `/automate` skill + Automations list reached; Automations editor save unpaid |
| MAKE-BOT-UI-KEY-SERVER-HOST / PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001 | **no** | **no** | `/make-bot-ui` skill present; `update_state` / Routines / webhook create unproven |

## Desktop Ready

| Check | Result | Evidence |
| --- | --- | --- |
| Helper `check-permissions` | accessibility true, screenRecording true | `parity/research/automations-desktop-001/01-permissions.json`, `37-verify-permissions.json` |
| Helper `desktop-share-status --mode view_and_control` | ready true | `02-desktop-share-status.json`, `37-verify-desktop-share.json` |
| `cursor-agent worker --debug debug` | Computer use Ready=yes; Desktop share Ready=yes | `03-worker-debug.txt`, `37-verify-worker-debug.txt` |

Sticky Agents Window path from attempt `521ce15e` reused as the drive baseline (`cmd+n` New Chat, keyboard preferred, helper shots 1280x800).

## Probe 1. Benny creation-boundary

| Step | Result | Screen / attempt |
| --- | --- | --- |
| Agents Window New Chat | reached | `be874194` `screen-04-new-chat.png` |
| Type `/automate` | built-in **automate** skill in slash menu ("Trigger an agent…") | `be874194` `screen-05-slash-automate.png` |
| `cmd+shift+p` Open Automations | Automations host list, Mine empty, **New Automation** CTA | `16a11cc9` `screen-03-after-open-automations.png` |
| New Automation clicks (AX + relative) | stayed on list; editor draft not opened | `d540ea19` |
| Editor save / Benny enable | not done (forbidden / unpaid) | — |

Pi half unchanged. `cd378e36` env_blocked.

**Primary desktop attempt IDs.** slash `be874194-d680-4f9f-8a88-5ee1b4858a0f`; Open Automations `16a11cc9-c257-412c-bc71-fa8fd00ec609`; New Automation probe `d540ea19-389f-4d6c-a713-3d5b63a10883`.

## Probe 2. Make-bot Cursor half

| Step | Result | Screen / attempt |
| --- | --- | --- |
| Type `/make-bot-ui` in Agents Window | skill present (Make Bot UI / webhook sender key description) | `ecac27a8` `screen-02-slash.png` |
| Open Automations | same Automations list host | `ecac27a8` `screen-04-automations.png` |
| Palette Routines | No results found | `1e5149f4` `screen-08-palette-routines.png` |
| Palette update_state | No results found | `1e5149f4` `screen-09-palette-update-state.png` |
| cmd+shift+i Routines panel | not shown in this drive | `1e5149f4` `screen-07-cmd-shift-i.png` |
| Webhook create / sender key | not witnessed; not fabricated | — |

Pi half kept. `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` key_server_ok.

**Primary desktop attempt IDs.** slash `ecac27a8-740d-494b-bc1f-93f36d27f80f`; palette probe `1e5149f4-d4b5-4377-8587-ec2ed0e0db49`.

## Attempt IDs (summary)

| label | id |
| --- | --- |
| Benny desktop slash `/automate` | `be874194-d680-4f9f-8a88-5ee1b4858a0f` |
| Benny desktop Open Automations | `16a11cc9-c257-412c-bc71-fa8fd00ec609` |
| Benny New Automation probe | `d540ea19-389f-4d6c-a713-3d5b63a10883` |
| Benny PTY (prior) | `d6992fb0-3759-474f-b1da-dafa9e13fde8` |
| Benny Pi (prior) | `cd378e36-ef2e-4810-ae5d-74a5169f204c` |
| Make-bot desktop slash | `ecac27a8-740d-494b-bc1f-93f36d27f80f` |
| Make-bot desktop palette | `1e5149f4-d4b5-4377-8587-ec2ed0e0db49` |
| Make-bot PTY (prior) | `bb50ed1b-29ac-4961-bb0a-5c2ffd9834b2` |
| Make-bot Pi (kept) | `e75f8e08-0d8c-4d55-ad3f-6946c405bbaf` |

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-automations-desktop-001-report.md` |
| Benny blocker (updated) | `parity/evidence/setup-benny/blocker-setup-benny-creation-boundary-1.json` |
| Benny pair (updated) | `parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json` |
| Make-bot blocker (updated) | `parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json` |
| Make-bot pair (updated) | `parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json` |
| Research + decisions | `parity/research/automations-desktop-001/` |
| Lever | `parity/scripts/capture-automations-desktop-agents-window.py` |

## Gotchas

- Helper coordinate clicks need a fresh `get_app_state` first.
- Palette text can swallow `/make-bot-ui` if Escape is skipped after `Open Agents Window`.
- AX tree is rich on Agents Window titled "Cursor Agents"; New Automation button exists but helper presses did not enter editor chrome.
- Do not pick "Open Agents Window and Start Cloud Agent" (spending gate).

## Merge payload (for coordinator)

| Field | Benny creation-boundary | Make-bot Cursor half |
| --- | --- | --- |
| Can mismatch close? | **no** | **no** |
| Cursor half closed? | **no** | **no** |
| Success attempt ID | none (honest blocker) | none (honest blocker) |
| Desktop progress IDs | `be874194`, `16a11cc9` | `ecac27a8`, `1e5149f4` |
| Pi half | keep `cd378e36` | keep `e75f8e08` |
| Pair status | blocker | env_blocker |
| Ledger edits by this unit | none | none |
| Recommended ledger action | keep SETUP-BENNY-CREATION-BOUNDARY-ENV open; note desktop list + `/automate` skill reached | keep MAKE-BOT-UI-KEY-SERVER-HOST open; note desktop skill chrome without webhook APIs |

## Verify

- Helper permissions + desktop-share Ready after drive (`37-verify-*.json`, worker debug Ready=yes).
- Screens prove Automations list and slash skills under attempt dirs.
- No Automations editor save claimed.
- No sender key fabricated.
- No Slack posts, no Benny enable, no Cloud Agent mint.
- Ledgers not edited.

## Attention

reviewed by parent poteto-agent (brief forbids further subagents; show-me-your-work cross-model review skipped)

- New Automation editor entry still unproven under helper drive. Operator click may succeed where scripted clicks failed.
- Desktop share Mode in worker debug sometimes reports `view` while `desktop-share-status --mode view_and_control` stays ready. Keyboard drive still worked.
