# u-automations-web-editor-001 report

**status.** Honest measured blocker. Web Automations list reached at `cursor.com/automations`. New Automation editor chrome not witnessed under scripted Agent Helper paths on Chrome. Ledgers untouched. No commit. No save, enable, Slack, or Cloud Agent mint.

throughput checkpoint: n/a, read-only investigation

## Exit condition

Screens prove either editor draft chrome after New Automation on the web host, or exhaustive-negative that scripted AX / keyboard / click paths cannot enter the editor. Predicate met via exhaustive-negative on the web path.

## Verdict

| Field | Value |
| --- | --- |
| editorChromeWitnessed | **no** |
| Primary attempt ID | `b2ef3452-f4c1-41b9-8f73-3a335a0f8991` |
| Prior Agents Window exhaustive-negative | `5a404316-b586-4811-a895-8d702c5f0b57` |
| Merge recommendation | **keep-open** (do not close Cursor creation-boundary half; do not treat SETUP-BENNY-CREATION-BOUNDARY-ENV as advanced by this unit) |
| Ledger edits by this unit | none |

## Desktop Ready

| Check | Before | After |
| --- | --- | --- |
| Helper `check-permissions` | accessibility true, screenRecording true (`01-permissions.json`) | same (`37-verify-permissions.json`) |
| Helper `desktop-share-status --mode view_and_control` | ready true (`02-desktop-share-status.json`) | ready true (`37-verify-desktop-share.json`) |
| `cursor-agent worker --debug debug` | Computer use Ready=yes; Desktop share Ready=yes (`03-worker-debug.txt`) | Ready=yes (`37-verify-worker-debug.txt`) |

## What was tried

1. Opened `https://cursor.com/automations` in Google Chrome (`open -a` plus `cmd+l` re-nav). Signed-in Pro+ Automations list with Mine empty and two New Automation CTAs.
2. Fresh `get_app_state` then `click` `element_index` on both New Automation AXButtons (`67` header, `96` empty-state). `clickOk` true. Screens stayed on list.
3. Frame-center `x`/`y` clicks on both buttons. Screens stayed on list.
4. Tab cycle then Return and Space. No Escape. Host moved to `cursor.com/automations/runs` Run History (No Runs Yet). Still no editor markers.
5. Re-nav to list. Double-click header xy. `perform_secondary_action` AXShowMenu (helper returned Performed action). AXScrollToVisible then element_index click. Screens stayed on list.
6. Cursor `cmd+shift+p` Simple Browser open-URL attempt. Did not produce Automations draft editor chrome.

AX note. Web New Automation buttons exposed `AXShowMenu` and `AXScrollToVisible` only. No `AXPress`.

## Oracle (screens)

| Shot | What it shows |
| --- | --- |
| `…/screen-01-after-nav.png` | `cursor.com/automations` list, Mine empty, New Automation CTAs, No Automations Yet |
| `…/screen-02-idx-1-67.png` | Still list after header element_index click |
| `…/screen-03-xy-1-1351-232.png` | Still list after header xy click |
| `…/screen-06-after-return.png` | Run History after keyboard path (`/automations/runs`) |
| `…/screen-09-final.png` | Still Run History; no draft editor fields |
| `…/screen-11-dbl-xy.png` / `screen-13-scroll-then-click.png` | Back on list after extra click paths; still No Automations Yet |
| No AX file in the attempt dir | Contains editor-only markers (`Untitled Automation`, `Automation name`, `Save Automation`, `When this happens`, `Then do this`) without list empty-state dominance |

## Artifacts

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-automations-web-editor-001-report.md` |
| Research + decisions | `parity/research/automations-web-editor-001/` |
| Attempt meta | `parity/research/automations-web-editor-001/attempt-meta.json` |
| Evidence dir | `parity/evidence/setup-benny/creation-boundary/web/b2ef3452-f4c1-41b9-8f73-3a335a0f8991/` |
| Lever | `parity/scripts/capture-automations-web-editor.py` |

## Gotchas

- Web list is reachable and authenticated. Scripted New Automation entry still fails the same way as Agents Window (`5a404316`).
- Keyboard Tab/Return can leave the list for Run History. That is not editor chrome.
- Do not treat Automations dashboard chrome as editor chrome. Editor proof needs draft markers above.
- Do not Escape in ways that dismiss the Automations host.
- Do not click Create Cloud Environment, Connect Slack, or Start Cloud Agent.

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| Can Cursor creation-boundary half close? | **no** |
| editorChromeWitnessed | **no** |
| Success attempt ID | none |
| Progress attempt ID | `b2ef3452-f4c1-41b9-8f73-3a335a0f8991` |
| Recommended ledger action | keep SETUP-BENNY-CREATION-BOUNDARY-ENV open; note web list reachable; New Automation scripted entry unpaid on web and desktop |
| Pi half | unchanged (not in this unit's scope) |

## Verify

- Ready before and after drive.
- Visual re-read of list, post-click, Run History, and extra-path screens.
- Repo scan found no editor markers under the attempt dir.
- No Automations editor save claimed.
- No Benny enable, Slack, secrets, or Cloud Agent mint.
- Ledgers not edited.
