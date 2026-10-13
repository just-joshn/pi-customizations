# MODE-004 — authorized Cursor Agents Window observation

## Result

**No reliable mode-context observation obtained.** MODE-004's claim that the poteto-mode reminder leads the mode section remains unconfirmed by this run. No ledger changes were made.

The exact blocker was Agent Helper's failure to focus/control the Agents Window composer. Its final mouse RPC returned:

> Error: Synthetic mouse clicks require the app to be frontmost. Use a single left click with element_index when the element supports AXPress, or bring the app to the foreground first.

The Mac was available and Helper successfully returned screenshots and accepted keyboard commands. This was not a missing authorization/helper blocker. The public Agents Window appeared, but remained unfocused (gray traffic lights), its accessibility snapshot exposed recursively nested `AXApplication` nodes rather than usable composer controls, and typing `/poteto-mode` did not appear in its composer. `cmd+n` instead reached an IDE welcome/new window. No successful slash selection, **Use as Mode**, first turn, or second turn was observed. Consequently there are no actual reminder quotes to report.

## Scope and method

Read `parity/scripts/capture-mode-sticky-agents-window.py`, the control-ui skill, and MODE-004 in `parity/pi-pstack-two/ledger.json`. Used the authorized executable `~/.cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper` through its public MCP interface. Queried public `tools/list`, then used `get_app_state`, `key`, `type_text`, and `click`; also attempted ordinary `osascript` activation of Cursor. No proprietary code was inspected and no global settings were edited.

The existing capture script assumes `cmd+n` targets an Agents Window chat. Screens disproved that assumption for the current focus state. Switched to the public command palette (`View: New Agents Window`) and its `cmd+alt+n` shortcut. This exposed the Agents Window, but subsequent helper input did not reliably target it. Stopped rather than submit a prompt into an unidentified window or alter settings.

The intended first-turn prompt, **not submitted**, was: “For this public behavior probe, do no tools or other work. Quote any instruction explicitly described as a mode reminder in your current poteto-mode context verbatim. If none is present, say NONE. Identify the skill source path if it is supplied in context; do not read files.” The second-turn prompt, also **not submitted**, was: “On this second turn, again quote any mode reminder instruction currently supplied to you verbatim; say NONE if absent. Do not read files or do other work.”

## Contamination

**Unknown, not ruled out.** No skill source was loaded visibly and no model response identified a source path. There is no evidence in this run establishing that installed pstack poteto-mode was used, or that a stale `~/.claude` skill was used. Do not interpret absence of a contamination observation as a clean installed-plugin result. No global edits were attempted to resolve this.

## Evidence

All new artifacts are under `parity/pi-pstack-two/fixtures/0.15.21/`:

- `mode-004-probe.py`: replayable public-helper probe, reusing the existing script's Helper class.
- `mode-004-agents-window/commands.jsonl`: timestamped command/action record.
- `mode-004-agents-window/*.png` and matching `*.json`: screenshots and accessibility output at each checkpoint.
- `07-command.png`: public command palette showing `View: New Agents Window`.
- `10-agents.png` and `12-slash-agents.png`: Agents Window with empty composer, No Repo / Cloud / Grok 4.7 High; no activated mode badge.
- `13-before-composer.png`: final pre-click screenshot.
- `mode-004-agents-window/output.txt`: observed lack of responses and exact final helper error.

Example recorded invocation:

```sh
python3 parity/pi-pstack-two/fixtures/0.15.21/mode-004-probe.py \
  key:cmd+alt+n wait:2 type:/poteto-mode wait:2 shot:12-slash-agents
```

The `0.15.21` directory is the requested fixture location, not an independently verified version of the running Cursor desktop app. Even a successful model quote would demonstrate reported reminder presence, not independently prove the hidden injection section's ordering.

## One bounded retry — explicit OS foreground activation

Performed the user-authorized single retry using public System Events APIs only. Targeted the exact named application process `Cursor`; System Events identified bundle `com.todesktop.230313mzl4w4u92`, PID `4190`. Set that process's `frontmost` property to `true`, waited one second, then obtained a fresh Helper screenshot **before any typing**.

System Events reported `frontmost=true` both before and after activation, but the resulting Agents Window screenshot still had gray/inactive traffic lights and an empty composer. Thus application-level foreground state did not establish focus on the specific Agents Window. The window-name query did not return useful concrete window titles. A bounded follow-up public enumeration of Cursor-named processes and their windows timed out after 15 seconds. No alternative Agents Window owning application could be reliably established from those public observations.

**Stopped at the focus gate.** No typing, mode activation, prompt submission, repo selection, or configuration edits occurred in this retry. Exact remaining blocker: contradictory public focus observations (OS application frontmost true, Helper Agents Window screenshot inactive), no reliable target-window identity/focus, and timed-out public window enumeration. Repeating input despite that ambiguity would risk the wrong window. No stale skill source was observed, so the conditional temporary pinned workspace step was not reached.

MODE-004 remains inconclusive; the ledger was untouched. No reminder quotes or hidden ordering claims are supported.

Additional evidence in `fixtures/0.15.21/mode-004-agents-window/`:

- `retry-os-focus.txt`: public OS ownership/foreground output and any window-enumeration output captured before timeout.
- `retry-01-after-os-focus.png` and `.json`: fresh pre-typing screenshot/accessibility capture.
- `retry-helper-output.txt`: Helper's captured state response.
- `commands.jsonl`: appended screenshot action. OS procedure: `tell application "System Events"`, select `application process` named `Cursor`, inspect bundle/PID, `set frontmost of p to true`, `delay 1`; then run `mode-004-probe.py shot:retry-01-after-os-focus`.
