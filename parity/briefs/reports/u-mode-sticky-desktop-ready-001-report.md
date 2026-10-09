# u-mode-sticky-desktop-ready-001 report

**status.** pass-paired. Cursor Agents Window sticky Custom Mode held across a follow-up turn. Pi sticky half revalidated. Pair JSON updated. Ledgers untouched by this unit. No commit.

throughput checkpoint: desktop Ready re-checked → Agents Window drive → screens prove sticky → pair updated

## Verdict

Cursor attempt `521ce15e-a8f8-4f74-8fec-208ceddb7603` reached Custom Mode via Agents Window `/poteto-mode` → `alt+Return` (Use as Mode). The crown `poteto-mode` badge stayed in the composer after the first reply (`sticky mode on`) and after the second reply (`7`). Pi attempt `96494327-f90c-470a-8e11-cf7c5b6cad89` still shows crown Poteto Mode on sticky submit, first turn, and second turn. Pair `parity/evidence/mode-sticky/pair-mode-sticky-1.json` is pass-paired. Merge recommendation for coordinator: close `MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS` and mark `PSTACK-MODE-STICKY-001` verified from this pair.

## Desktop Ready re-check (before and after)

| Check | Result | Evidence |
| --- | --- | --- |
| `screencapture -x` | exit 0, PNG written | `parity/research/mode-sticky-desktop-ready-001/00-desktop-ready-check.png` |
| Helper `check-permissions` | accessibility true, screenRecording true | `02-desktop-share-status.json`, `37-verify-permissions.json` |
| Helper `desktop-share-status --mode view_and_control` | ready true | `02-desktop-share-status.json`, `37-verify-desktop-share.json` |
| `cursor-agent worker … --debug debug` | Computer use Ready=yes; Desktop share Ready=yes | `04-worker-debug-cmd.txt`, `37-verify-worker-debug.txt` |
| IDE auth | signed-in; `stripeMembershipType=pro_plus` | `05-auth-glass.txt` |

No restart was requested or performed.

## UI path that passed

| Step | Result | Screen |
| --- | --- | --- |
| Agents Window New Chat | reached | `26-after-new.png` / evidence `screen-02…` lineage |
| Type `/poteto-mode` | slash menu; **to Use as Mode** footer on poteto-mode | `screen-01-slash-use-as-mode.png` |
| `alt+Return` | crown `poteto-mode` badge in composer | `screen-02-custom-mode-badge.png` |
| First task + Return | assistant replied `sticky mode on`; badge still in Send follow-up | `screen-04-after-first-turn-sticky.png` |
| Follow-up + Return | assistant replied `7`; badge still present | `screen-06-after-second-turn-sticky.png` |

## Attempt IDs

| label | id | sticky |
| --- | --- | --- |
| Cursor Agents Window sticky | `521ce15e-a8f8-4f74-8fec-208ceddb7603` | yes |
| Pi sticky (revalidated) | `96494327-f90c-470a-8e11-cf7c5b6cad89` | yes |
| Prior CLI harness limitation (superseded for Cursor half) | `9a6e00d0-b7c7-43c1-b09a-7a2db3209dc7` | no (PTY Option+Enter) |

## Overview

Prior units were env-blocked (no display, screencapture fail, signed-out IDE) or CLI-gated (`glass_custom_modes` off). With desktop share Ready and a signed-in Pro+ Cursor.app, Agents Window exposes Use as Mode. That path closes the Cursor sticky half without fabricating chrome.

## Key concepts

- Agents Window. Cursor desktop agent UI with New Chat and slash skills.
- Use as Mode. Slash footer / Option+Enter path that sticks a skill as Custom Mode.
- Sticky. Mode badge remains after a follow-up turn.

## How it works

1. Confirm desktop share Ready via helper + worker debug.
2. Activate Cursor. Open Agents Window New Chat (`cmd+n` after Agents Window is up).
3. Type `/poteto-mode`. Confirm Use as Mode footer.
4. Send `alt+Return`. Confirm crown `poteto-mode` badge.
5. Send first task and follow-up. Confirm badge after each reply.
6. Link Pi half. Update pair JSON. Publish report for coordinator merge.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-mode-sticky-desktop-ready-001-report.md` |
| Pair (updated) | `parity/evidence/mode-sticky/pair-mode-sticky-1.json` |
| Cursor evidence | `parity/evidence/mode-sticky/agents-window/521ce15e-a8f8-4f74-8fec-208ceddb7603/` |
| Pi evidence | `parity/evidence/mode-sticky/pi/96494327-f90c-470a-8e11-cf7c5b6cad89/` |
| Research + decisions | `parity/research/mode-sticky-desktop-ready-001/` |
| Lever | `parity/scripts/capture-mode-sticky-agents-window.py` |

## Gotchas

- Helper screenshots are 1280x800. Clicks at full Retina coords fail. Prefer keyboard (`alt+Return`).
- Cursor AX tree from helper was empty (`windows=0` via System Events). Screenshots still prove chrome.
- Parallel Computer Use exercise opened TextEdit and Alacritty TCC sheets. Clear those before driving Agents Window.
- CLI PTY Option+Enter remains gated. This pass is Agents Window only.

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| Can mismatch close? | **yes** |
| Cursor sticky half closed? | **yes** |
| Cursor success attempt ID | `521ce15e-a8f8-4f74-8fec-208ceddb7603` |
| Pi half | keep `96494327-f90c-470a-8e11-cf7c5b6cad89` |
| Pair status | pass-paired |
| Ledger edits by this unit | none |
| Recommended ledger action | close `MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS`; set `PSTACK-MODE-STICKY-001` verified from pair `mode-sticky-1`; note CLI glass path still off but requirement satisfied via Agents Window |

## Verify

Re-ran after writing artifacts.

- Helper permissions and desktop-share status still ready (`37-verify-*.json`, `37-verify-worker-debug.txt`).
- Evidence screens present under attempt dir (`screen-01` … `screen-06`).
- `observations.json` records Use as Mode, sticky badge after both turns, replies.
- Pi screens still contain `👑 Poteto Mode` on sticky submit / first / second turn.
- Pair JSON points Cursor at `521ce15e…` and Pi at `96494327…` with `pairStatus: pass-paired`.
- Visual re-read of `screen-01`, `screen-04`, `screen-06` shows Use as Mode footer, then sticky badge after turn 1, then badge after turn 2 with reply `7`.

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, `parity/dependencies.json`, `parity/progress.md`, `parity/source-lock.json`, or `parity/completion.json`. Did not commit. Did not spawn further subagents. Did not fabricate Custom Mode chrome. Did not tell the operator to restart.
