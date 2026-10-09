# u-automations-new-editor-001 report

**status.** Honest measured blocker. Automations list reached. New Automation editor chrome not witnessed under scripted Agent Helper paths. Ledgers untouched. No commit. No save, enable, Slack, or Cloud Agent mint.

throughput checkpoint: n/a, read-only investigation

## Exit condition

Screens prove either editor draft chrome after New Automation, or exhaustive-negative that scripted AX / keyboard / click paths cannot enter the editor. Predicate met via exhaustive-negative.

## Verdict

| Field | Value |
| --- | --- |
| editorChromeWitnessed | **no** |
| Primary attempt ID | `5a404316-b586-4811-a895-8d702c5f0b57` |
| Supporting lever attempt | `f24f4aa6-a9a4-4cc9-b257-0a885926030b` |
| Merge recommendation | **keep-open** (do not close Cursor creation-boundary half) |
| Ledger edits by this unit | none |

## Desktop Ready

| Check | Before | After |
| --- | --- | --- |
| Helper `check-permissions` | accessibility true, screenRecording true (`01-permissions.json`) | same (`37-verify-permissions.json`) |
| Helper `desktop-share-status --mode view_and_control` | ready true (`02-desktop-share-status.json`) | ready true (`37-verify-desktop-share.json`) |
| `cursor-agent worker --debug debug` | Computer use Ready=yes; Desktop share Ready=yes (`03-worker-debug.txt`) | Ready=yes; Desktop Mode sometimes `view` (`37-verify-worker-debug.txt`) |

## What was tried

Fresh `get_app_state`, then:

1. `click` with `element_index` on both AXButtons titled New Automation (`171` header CTA, `197` empty-state CTA). `clickOk` true. Screens stayed on list.
2. Frame-relative `x`/`y` clicks after fresh state (header center ~`1126,118`; scrolled empty-state ~`765,749`). Screens stayed on list.
3. Double-click `element_index` on both indices. Screens stayed on list.
4. Tab / Shift+Tab focus cycles, then Return and Space. Screens stayed on list.

AX dump prior art (`parity/research/automations-desktop-001/ax-automations.txt`) already contained New Automation at index `171` with `AXPress`. This unit reproduced that button and still could not enter editor chrome.

## Oracle (screens)

| Shot | What it shows |
| --- | --- |
| `5a404316…/screen-03-list.png` | Automations host, Mine empty, New Automation CTAs |
| `5a404316…/screen-04b-xy-171-1126-118.png` | Still list after header xy click |
| `5a404316…/screen-09-final.png` | Still list / Automations landing; no draft editor fields |
| `f24f4aa6…/screen-04-click-0-idx-171.png` | After index `171`, helper sometimes surfaces IDE key window instead of editor |
| No AX file in the attempt dirs | Contains editor-only markers (`Untitled Automation`, `Automation name`, `Save Automation`, `When this happens`, `Then do this`) without `No Automations Yet` |

## False starts (do not treat as success)

| Attempt | Issue |
| --- | --- |
| `c4f3d7c8-e830-4efa-adef-784bf04bbb36` | Heuristic used chat `Discard`/`Draft` strings; Escape after Open Automations dismissed the list; `newAutomationButtons` empty |
| `e5eaace1-aff8-4185-a3be-983618edacb2` | AX walker only followed `children`, missed `window` root; fixed in lever before exhaustive run |

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-automations-new-editor-001-report.md` |
| Research + decisions | `parity/research/automations-new-editor-001/` |
| Exhaustive meta | `parity/research/automations-new-editor-001/exhaustive-meta.json` |
| Evidence dir | `parity/evidence/setup-benny/creation-boundary/agents-window/5a404316-b586-4811-a895-8d702c5f0b57/` |
| Lever | `parity/scripts/capture-automations-desktop-agents-window.py` (`neweditor` mode) |

## Gotchas

- Do not Escape after Open Automations. Escape leaves the Automations host.
- `get_app_state` JSON roots at `{app, window}`. Walk must enter `window`, not only top-level `children`.
- Chat chrome contains `Discard` / `Draft`. Those are not Automations editor proof.
- Helper `element_index` clicks can report success while the UI stays on the list, or while the IDE becomes the key window.
- Do not click Connect Slack or Open Agents Window and Start Cloud Agent.

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| Can Cursor creation-boundary half close? | **no** |
| editorChromeWitnessed | **no** |
| Success attempt ID | none |
| Progress attempt ID | `5a404316-b586-4811-a895-8d702c5f0b57` |
| Recommended ledger action | keep SETUP-BENNY-CREATION-BOUNDARY-ENV open; note list reachable; New Automation scripted entry unpaid |
| Pi half | unchanged (not in this unit's scope) |

## Verify

- Ready before and after drive.
- Visual re-read of final and post-click screens. Still Automations list.
- No Automations editor save claimed.
- No Benny enable, Slack, secrets, or Cloud Agent mint.
- Ledgers not edited.
