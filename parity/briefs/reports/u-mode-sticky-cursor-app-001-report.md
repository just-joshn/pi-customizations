# u-mode-sticky-cursor-app-001 report

**status.** exhaustive-negative (env-blocked). Cursor.app is present. Sticky Custom Mode still not reached. No Cursor success attempt ID. Ledgers untouched by this unit. No commit.

throughput checkpoint: n/a, read-only investigation

## Verdict

`/Applications/Cursor.app` is installed (version `3.24.9`, bundle `com.todesktop.230313mzl4w4u92`, Contents present). The prior Agents Window report’s “Cursor.app absent” finding is obsolete. Sticky Custom Mode via Agents Window slash → Use as Mode is still unreachable on this host. Measured blockers are empty `DISPLAY`, failed `screencapture` (`could not create image from display`), closed CDP ports, no computer-use MCP in session, IDE `glass.lastSignedInAuthId=signed-out`, `User/settings.json` with no Custom Modes keys, and `glass_custom_modes` string absent from CLI statsig-cache and IDE statsig bootstrap. Prior CLI exhaustive-negative still stands (`6977eeec`, `9857dda0`). Pi sticky half remains `96494327-f90c-470a-8e11-cf7c5b6cad89`. Pair JSON left unchanged.

## Cursor.app findings

| Check | Result | Evidence |
| --- | --- | --- |
| `/Applications/Cursor.app` | present | `test -d`; `host-probe/00-host-inventory.txt` |
| Contents | present | `ls Contents` (MacOS, Info.plist, Frameworks, Resources) |
| Version / bundle | `3.24.9` / `com.todesktop.230313mzl4w4u92` | `defaults read … Info.plist` |
| `cursor` shim finds IDE | yes | `05-cursor-shim.txt` (no longer “No Cursor IDE installation found”) |
| Application Support | present | `~/Library/Application Support/Cursor` |
| `User/settings.json` | present, 44 bytes | only `window.autoDetectColorScheme`; no Custom Modes keys |
| Mid-unit Cursor GUI | briefly observed, then gone | `ps` showed `Contents/MacOS/Cursor` and `extension-host Agents Window [1-1]`; formal lever snapshot and verify re-check had no Cursor main / Agents Window process |

## UI paths tried

| Path | Reachable | Custom Mode chrome | Notes |
| --- | --- | --- | --- |
| Desktop Cursor.app install | yes | n/a | Present at `/Applications/Cursor.app` |
| Desktop → Agents Window → slash → Use as Mode | no | absent | No display capture; CDP closed; computer-use MCP absent; cannot drive or prove Use as Mode |
| Desktop Settings → Custom Modes toggle | settings file yes; toggle no | absent | settings.json lacks customMode / Use as Mode / glass_custom_modes |
| `cursor` shim open IDE | shim finds IDE | absent | Help identifies Cursor 3.24.9; does not yield sticky chrome |
| CDP attach | no | absent | 9222, 9223, 9229, 9230, 9333 closed |
| Computer-use drive | no | absent | GetDynamicTools pattern `computer\|screenshot\|browser\|cdp\|playwright` → `[]`; screencapture fails |
| cursor-agent PTY Meta+Enter | prior negative | absent | Not reclaimed as success; attempts `6977eeec`, `9857dda0` |

## Attempt IDs

| label | id | customModeStickyReached |
| --- | --- | --- |
| cursor-app host probe | `b01ad4e8-f88a-4e53-ac22-d3646d8e11b9` (probeId after verify re-run; not a Cursor agent attempt) | false |
| Cursor sticky success attempt | none | false |
| Pi sticky (unchanged) | `96494327-f90c-470a-8e11-cf7c5b6cad89` | true (Pi crown path) |

Success Cursor attempt ID: none.

## Measured blockers

1. `DISPLAY` unset; `screencapture -x` exits 1 with `could not create image from display`.
2. CDP ports 9222/9223/9229/9230/9333 closed.
3. No computer-use / screenshot / browser MCP tools in this agent session.
4. `glass.lastSignedInAuthId` is `signed-out`; `cursorAuth/stripeMembershipType` is `free`.
5. `User/settings.json` has no Custom Modes toggle.
6. `~/.cursor/statsig-cache.json` has no `glass_custom_modes` string; IDE `workbench.experiments.statsigBootstrap` likewise (hashed gate names only; zero `glass_*` name hits).
7. Agents Window slash → Use as Mode not driveable under the above.

## Overview

Sticky Custom Mode for the Cursor half of `PSTACK-MODE-STICKY-001` needs a path that can open Agents Window (or CLI with `glass_custom_modes` on), pick `/poteto-mode`, choose Use as Mode, and keep mode chrome across a follow-up turn. This unit updates the host fact that Cursor.app is installed and that Application Support exists. The capture path is still blocked by display, automation, auth, and gate observability.

## Key concepts

- Agents Window. Cursor desktop agent UI (`extension-host Agents Window` when live).
- Use as Mode. Slash skill action that sticks a skill as Custom Mode across turns.
- Env-blocked. Binary/settings may exist, yet the journey cannot be driven or proven on this capture host.

## How it works

1. Install Cursor desktop (done on this host).
2. Sign in under an account with Custom Modes / `glass_custom_modes` available.
3. Open Agents Window with a driveable display (or CDP / computer-use).
4. Type `/poteto-mode`, choose Use as Mode, send sticky first task, then follow-up, capture chrome.

This host fails at steps 2–3 before Custom Mode chrome can be measured.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-mode-sticky-cursor-app-001-report.md` |
| Probe lever | `parity/research/mode-sticky-cursor-app-001/probe-cursor-app-sticky-host.mjs` |
| Probe JSON | `parity/research/mode-sticky-cursor-app-001/host-env-probe.json` |
| Host screens | `parity/research/mode-sticky-cursor-app-001/host-probe/` |
| Prior absent-app report | `parity/briefs/reports/u-mode-sticky-agents-window-report.md` |
| Prior CLI negative | `parity/briefs/reports/u-cursor-custom-mode-path-report.md` |
| Pi sticky attempt | `parity/evidence/mode-sticky/pi/96494327-f90c-470a-8e11-cf7c5b6cad89` |
| Pair (Cursor half still harness-limitation) | `parity/evidence/mode-sticky/pair-mode-sticky-1.json` |

## Gotchas

- Cursor.app present does not imply sticky Custom Mode is capturable.
- An Agents Window process name is not Custom Mode chrome.
- Do not mark `PSTACK-MODE-STICKY-001` or `MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS` closed from this report.
- Fabricating Use as Mode / glass overrides is forbidden; this unit did not.

## Merge payload (for coordinator)

| Field | Value |
| --- | --- |
| Can mismatch close? | **no** |
| Cursor sticky half closed? | **no** |
| Cursor.app status | present (`/Applications/Cursor.app`, 3.24.9) |
| Cursor success attempt ID | none |
| Pi half | keep `96494327-f90c-470a-8e11-cf7c5b6cad89` |
| Ledger edits by this unit | none |
| Recommended ledger action | keep `MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS` / Cursor side of `PSTACK-MODE-STICKY-001` open; note prior “app absent” is superseded by this env-blocked report |

## Verify

Re-ran after writing artifacts.

- `test -d /Applications/Cursor.app` → present; Contents present; version `3.24.9`.
- `DISPLAY` unset; `screencapture` → `could not create image from display`.
- CDP ports listed above → closed.
- settings.json → autoDetectColorScheme only.
- sqlite glass auth → `signed-out` / `free`.
- statsig-cache → no `glass_custom_modes` string.
- Pi dir `96494327-…` still present.
- `rg` Custom Mode chrome under host-probe → only explicit absence notes.
- Re-run lever. `node parity/research/mode-sticky-cursor-app-001/probe-cursor-app-sticky-host.mjs`

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, `parity/dependencies.json`, `parity/progress.md`, `parity/source-lock.json`, or `parity/completion.json`. Did not commit. Did not spawn further subagents. Did not fabricate Custom Mode chrome or glass overrides. Did not set requirement verified.
