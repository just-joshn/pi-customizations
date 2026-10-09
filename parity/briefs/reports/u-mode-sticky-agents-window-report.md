# u-mode-sticky-agents-window report

**status.** exhaustive-negative (host-blocked). Custom Mode sticky not reached. No Cursor success attempt ID. Ledgers untouched. No commit.

throughput checkpoint: n/a, read-only investigation

## Verdict

This host cannot open Cursor Agents Window or IDE settings, so sticky Custom Mode via slash → Use as Mode was not measured. Cursor.app is absent. The `cursor` shim prints `No Cursor IDE installation found`. Application Support for Cursor is absent. No Custom Modes settings toggle exists on disk. CDP ports for a running Electron Cursor are closed. Computer-use tools are not available in this session, and `screencapture` cannot create an image from the display. Prior CLI exhaustive-negative still stands (`glass_custom_modes` off). Pi sticky half remains `96494327-f90c-470a-8e11-cf7c5b6cad89`.

## UI paths tried

| Path | Reachable | Custom Mode chrome | Notes |
| --- | --- | --- | --- |
| Desktop Cursor.app → Agents Window → slash → Use as Mode | no | absent | `mdfind` empty; `/Applications` has no Cursor.app (only Visual Studio Code.app among editor-ish names) |
| Desktop Cursor Settings → Custom Modes toggle | no | absent | `~/Library/Application Support/Cursor` missing; no `User/settings.json` |
| `cursor` shim open IDE / Agents Window | no | absent | Error text captured in `05-cursor-shim-error.txt` |
| CDP attach to Cursor Electron | no | absent | Ports 9222, 9223, 9229, 9230 closed; foreground processes have no Cursor |
| Computer-use drive of Agents Window | no | absent | No computer-use MCP namespace in session; screencapture failed (`could not create image from display`) |
| cursor-agent PTY Meta+Enter / Use as Mode | out of scope (prior) | absent | Attempts `6977eeec`, `9857dda0` in `u-cursor-custom-mode-path-report.md` |

## Attempt IDs

| label | id | customModeStickyReached |
| --- | --- | --- |
| agents-window host probe | `3c169585-3597-479e-94c9-590891dc8e1f` (probeId, not a Cursor agent attempt) | false |
| Cursor sticky success attempt | none | false |
| Pi sticky (unchanged) | `96494327-f90c-470a-8e11-cf7c5b6cad89` | true (Pi crown path) |

Success Cursor attempt ID: none.

## Verify

Re-read screens under `parity/evidence/mode-sticky/agents-window/host-probe/`.

- `02-applications-listing-screen.txt` lists `/Applications` with `cursorish_entries: (none)` and states Custom Mode chrome absent.
- `05-cursor-shim-error.txt` is the IDE-missing error.
- `01-foreground-apps.txt` lists Finder, Desktop Plus, Preview, Google Chrome, ghostty, Phone, Slack, Messages (no Cursor).
- `rg` for `Custom Mode|Use as Mode|option+enter to use as mode|Mode active` finds only the explicit absence line in the applications listing screen, not product chrome.

## Artifacts

- Lever. `parity/evidence/mode-sticky/agents-window/probe-agents-window-host.mjs`
- Probe JSON. `parity/evidence/mode-sticky/agents-window/host-env-probe.json`
- Paths JSON. `parity/evidence/mode-sticky/agents-window/ui-paths-tried.json`
- Host screens. `parity/evidence/mode-sticky/agents-window/host-probe/`
- Pair JSON. left unchanged (`parity/evidence/mode-sticky/pair-mode-sticky-1.json`); Cursor half still `9a6e00d0` harness-limitation, not a new sticky pass

## Overview

Docs place Custom Modes in Agents Window and CLI. CLI is already gated off on this account. Agents Window needs the Cursor desktop app. This machine has `cursor-agent` only, so the Agents Window half of the sticky requirement stays unpaid.

## Key concepts

- Agents Window. Cursor 3 agent-first desktop UI (`Cmd+Shift+P` → Open Agents Window).
- Use as Mode. Slash skill entry action (or Option+Enter) that keeps a skill as Custom Mode across turns.
- Host-blocked. Required UI binary or settings surface missing, so the journey cannot start.

## How it works

1. Install and sign in to Cursor desktop.
2. Open Agents Window.
3. Type `/poteto-mode`, choose Use as Mode (or Option+Enter when the mode footer is present).
4. Send the sticky first task, then a follow-up turn, and capture Custom Mode chrome still active.

On this host step 1 fails before any slash menu exists in Agents Window.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-mode-sticky-agents-window-report.md` |
| Probe lever | `parity/evidence/mode-sticky/agents-window/probe-agents-window-host.mjs` |
| Docs claim | `parity/research/cursor-host/customization/sources/prompting.md` § Custom Modes |
| Agents Window docs | https://cursor.com/docs/agent/agents-window |
| Prior CLI negative | `parity/briefs/reports/u-cursor-custom-mode-path-report.md` |
| Operator gate checklist | `parity/briefs/reports/u-operator-env-gates-001-report.md` gate 1 |

## Gotchas

- `cursor-agent --mode plan|ask` is not Custom Mode.
- Cloud agents at cursor.com/agents are not the desktop Agents Window Custom Mode path measured here.
- Installing Cursor IDE elsewhere does not help until this reference host (or a designated capture host) can open Agents Window under the same account gates.
- Do not mark `PSTACK-MODE-STICKY-001` verified from this report.

## Coordinator next actions (report only)

1. Keep Cursor sticky unverified and MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS open.
2. Install Cursor desktop on the capture host (or move capture to a host that already has it), enable Custom Modes / `glass_custom_modes` if still required, then recapture Agents Window sticky with a real Cursor attempt ID and follow-up-turn screens.
3. Leave Pi attempt `96494327` linked if still valid.

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`. Did not commit. Did not spawn further subagents. Did not fabricate Custom Mode chrome.
