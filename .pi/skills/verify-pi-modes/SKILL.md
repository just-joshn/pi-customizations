---
name: verify-pi-modes
description: Drive the pi-modes extension through the real Pi CLI in an isolated profile with a deterministic fake model. Use to verify Agent, Ask, Plan, Debug, and skill-backed custom modes, read-only shell enforcement, mode switching, session persistence, and before shipping any pi-modes change.
---

# Verify pi-modes

Read [features/README.md](features/README.md) first, then the feature being checked. This is a Pi extension, not a server or web app. Its primary surface is Pi's terminal UI and print CLI. The package ships one extension entry, `pi.extensions[0]` in `extensions/no-ceilings/pi-modes/package.json`, which registers the modes, commands, and tools. Unit tests and the test harness are supporting evidence, not a substitute for driving the real `pi` binary.

Run commands from the repository root. Retain the **literal absolute** `HELPER` and `EVIDENCE` values across tool calls; shell variables do not persist between tools.

## Launch

Requirements: `pi` **>=1.5.2** on PATH (tested with 1.6.0), Node **>=22.19.0**, installed dependencies, and macOS or Linux. Install dependencies once if `extensions/no-ceilings/pi-modes/node_modules` is missing:

```sh
bun install --frozen-lockfile
```

There is no build, migration, seed data, or persistent server. Source is loaded directly through Pi's extension loader. Create one evidence directory per journey:

```sh
REPO="$PWD"
HELPER="$REPO/.pi/skills/verify-pi-modes/scripts/verify.mjs"
EVIDENCE="$REPO/.pi/verification-evidence/pi-modes/$(date -u +%Y%m%dT%H%M%SZ)-$$"
node "$HELPER" init "$EVIDENCE"
node "$HELPER" doctor "$EVIDENCE"
```

`init` records the Pi executable/version, Node version, package version, source hash, and evidence path in `state.json`. It creates no profile and starts no process. `doctor` is the readiness gate; it also writes `doctor.json`.

For the automated journey, run the helper's drive command:

```sh
node "$HELPER" drive "$EVIDENCE"
```

`drive` starts the real `pi` binary with the checkout's extension and the repository's deterministic OpenAI-compatible fake model in a throwaway workspace, agent profile, skill directory, and session directory. Readiness is **exit 0**, all `ok` lines, `PASS deterministic end-to-end mode checks`, and a copied `e2e-root/`. A live `pi` process alone is not readiness.

The fake model is a production-boundary substitute. It proves mode plumbing, loadouts, prompt guidance, tool gating, persistence, and command handling. It does not prove real-model prose, provider behavior, or credentials. For a real-model run, use the package's `verify-modes.mjs` only when a logged-in model is available; it exits 77 when credentials are missing and is not a substitute for the deterministic run.

For a feature that needs the interactive TUI, launch a fresh isolated profile and workspace explicitly:

```sh
mkdir -p "$EVIDENCE/tui/agent" "$EVIDENCE/tui/work"
cd "$EVIDENCE/tui/work"
PI_CODING_AGENT_DIR="$EVIDENCE/tui/agent" \
  pi -ne -e "$REPO/extensions/no-ceilings/pi-modes/src/index.ts" \
  -np -nc --no-themes
```

Run it in a tmux session you own. Do not drive the user's normal Pi profile. The fake-model helper is preferred for scripted checks; the TUI is for commands and UI that print mode cannot expose.

## Doctor

Run this read-only check first whenever anything looks off:

```sh
node "$HELPER" doctor "$EVIDENCE"
```

Require `status: ready`, Pi at least 1.5.2 and unchanged from `init`, Node at least 22.19, unchanged package version and source hash, the fake-model e2e files, and installed dependencies. Doctor does not start Pi, contact a provider, or repair state. A changed source, Pi upgrade, missing dependency, or changed package version needs a fresh `init` and a new run. For an already launched TUI, require its owned pane and a working command; a live process alone is not proof.

## Drive

The default journey is the repository's fake-model e2e. It covers the read-only Ask loadout and blocked mutating bash, custom mode entry and sticky reminder, `/mode off`, appearance writes, one-message skill attachment, `switch_mode`, `/mode plan`, inline prompts, unknown mode warning, extension-triggered turns, and resume without a duplicate state snapshot. The Agent control comparison needs the real-model e2e.

Use the `ok` lines in `stdout.log` as the feature assertions. The check names are stable and listed in the feature files. For a single feature, read its mapped `ok` lines in `stdout.log` and inspect `e2e-root/`; do not claim the unlisted checks passed.

For a manual TUI journey, use the launch above, send commands as literal text, and capture the screen after each action. Feature recipes name the exact commands and expected text. Do not call extension internals, `callTool`, or the test harness as user-path proof.

## Evidence

Durable location: **`.pi/verification-evidence/pi-modes/<run-id>/`**. It is ignored by Git; never commit evidence. The helper writes:

- `state.json`, `doctor.json`: build identity and readiness checks.
- `stdout.log`, `stderr.log`, `drive.json`: exact command, exit code, signal, timeout, duration, and whether the run passed.
- `e2e-root/`: copied workspace, isolated agent profile, skill fixtures, and session directories from the fake-model run.
- `result.md`: the agent's feature-by-feature verdict and assertions. Write this before cleanup.
- `cleanup.json`: what was removed and whether evidence survived.

Proof standards:

- Exercise the real `pi` binary and the extension entry from `package.json`, not a direct import or the test harness.
- Capture the action and the resulting state. A final `PASS` line alone is insufficient for a specific feature; read the mapped `ok` line and the relevant session or workspace artifact.
- Check side effects independently: the blocked `victim.txt` must still exist, the custom skill file body must survive appearance writes, and the plan file or Debug log must exist when claimed.
- The fake model is allowed only at the provider boundary. Do not seed responses to bypass mode logic.
- A missing precondition makes that journey **NOT VERIFIED**, not passed through a different entry point. Record the exact failure.
- Do not claim a real-model, OAuth, browser, or provider result from the fake-model run.

## Cleanup

After every successful **or failed** attempt:

1. Copy any feature-specific artifacts that live inside `e2e-root/` or the TUI scratch area into the evidence root.
2. Run:

   ```sh
   node "$HELPER" cleanup "$EVIDENCE"
   ```

   It removes only the temporary `pi-modes-fake-e2e-*` root recorded in `state.json`; it never removes evidence. A timed-out drive kills its own process group; if cleanup reports a path outside `/tmp` or an unexpected name, stop and inspect instead of deleting it.
3. Confirm `cleanup.json` reports `evidencePreserved: true` and `e2e-root/`, `stdout.log`, `drive.json`, and `result.md` still exist. Do not remove evidence after cleanup. For a TUI run, stop only the tmux session you started; never kill by process name.

## Helpers

Executable `scripts/verify.mjs`, Node standard library only:

- `init EVIDENCE`: create the evidence directory and record Pi, Node, package, source hash, and paths.
- `doctor EVIDENCE`: write `doctor.json` and print readiness; read-only.
- `drive EVIDENCE`: run `test/e2e/verify-modes-fake.mjs` with `PI_MODES_E2E_KEEP=1`, capture logs, and copy its temporary root into `e2e-root/`.
- `cleanup EVIDENCE`: remove only the recorded temporary fake-e2e root and write `cleanup.json`.

After adding or changing this skill, run `/reload` in the Pi session that will use it. Use `/skill:maintain-verification-skill` when commands or user journeys change.
