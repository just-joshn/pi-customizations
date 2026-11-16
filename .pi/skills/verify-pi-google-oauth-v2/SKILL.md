---
name: verify-pi-google-oauth-v2
description: Drive pi-google-oauth-v2 through native Pi 1.5.2 terminal UI and CLI in an isolated profile. Use to verify Google AI subscription sign-in, Gemini model/thinking selection, streaming requests, and instruction priority with real tool replay.
---

# Verify pi-google-oauth-v2

Read [features/README.md](features/README.md) first, then the relevant feature file. This is a native Pi extension, not a web app or standalone service. The primary surface is Pi's terminal UI; print/JSON CLI and the existing live probe are additional entry points. The extension registers `google-oauth-v2` / **Google AI subscription** and adds **no slash commands**, including no usage command.

## Launch

Requirements: macOS/Linux, Python 3, tmux, Bun, Node >=22.19, and `pi` 1.5.2 on PATH (the extension's documented tested version). Use the installed Pi CLI, not a test double. From the repository root:

```sh
bun install --frozen-lockfile
bun run --filter @justjoshn/pi-google-oauth-v2 test
bun run --filter @justjoshn/pi-google-oauth-v2 typecheck
REPO="$PWD"
HELPER="$REPO/.pi/skills/verify-pi-google-oauth-v2/scripts/verify.py"
EVIDENCE="$REPO/.audit/verify-pi-google-oauth-v2/evidence/$(date -u +%Y%m%dT%H%M%SZ)-$$"
python3 "$HELPER" init "$EVIDENCE"
python3 "$HELPER" doctor "$EVIDENCE"
```

Retain the **literal absolute** `HELPER` and `EVIDENCE` values across tool calls; shell variables do not carry between tools. `state.json` records the checkout hash, disposable agent/work paths, and hashes (never contents) of the source profile's auth/settings/models files. No build, migrations, seed data, or server are needed. `init` starts with an empty profile, no credentials, retries disabled, and Flash as the startup model when the TUI is launched explicitly. Scratch lives under `.audit/verify-pi-google-oauth-v2/scratch/` so managed sandbox jobs can write it. An empty profile is usable for the login surface and unauthenticated-state check, **not** available-model selection or requests.

The helper isolates the working directory and `PI_CODING_AGENT_DIR`, ignores project trust/resources, disables MCP, other extensions, skills and context files, and clears inherited API-key env vars and Node instrumentation. Only the checkout's `src/index.ts` is explicitly loaded. It never installs this extension into the normal profile.

**Offline CLI readiness:**

```sh
python3 "$HELPER" run "$EVIDENCE" -- --offline --list-models google-oauth-v2
```

Read the recorded stdout/stderr/exit artifacts. On an **empty profile**, Pi 1.5.2 reports `No models available` even with exit `0`, because it lists only configured providers. Record this unauthenticated state, not a catalog pass. For actual baseline selection, use `copy-auth` below (or complete real login first), keep `--offline`, rerun the command and require provider `google-oauth-v2` and baseline families `gemini-4-argon` and `gemini-3.8-flash`. No copied catalog is seeded. An extension-load warning or missing row after configuring OAuth is a failure.

**Interactive readiness:** call `tmux_run` with a unique name and a command consisting of the absolute equivalents of:

```sh
python3 "$HELPER" serve-tui "$EVIDENCE" -- --offline
```

The managed command owns a real 140x40 PTY and stays in the foreground, forwarding output to its tmux pane. Managed commands have no interactive stdin: **do not run `tui` directly through `tmux_run` or use tmux `send-keys` for input**. Save the returned **job ID and exact tmux attach target**. If the attach command includes `-L` or `-S`, retain it in every tmux capture/resize command. Resize the managed window to at least 150x50 with `tmux resize-window -t "$TARGET" -x 150 -y 50` (plus its socket flags) before capturing, so the PTY footer fits. Do not guess a session or drive a user session. Wait for the editor and `gemini-3.8-flash` footer, with no extension-load error; process alive alone is insufficient. If startup was clipped before resize, open and close a selector to redraw before capturing.

For authenticated journeys, exit this offline TUI first. Start a new managed `serve-tui` run **without `--offline`**. Sign in from the empty profile as described in [login](features/login.md). Alternatively, when explicitly authorized to use an existing subscription:

```sh
python3 "$HELPER" copy-auth "$EVIDENCE"
python3 "$HELPER" doctor "$EVIDENCE"
```

This copies only Google's OAuth entry (0600) into scratch and never prints it. Use it before the offline selector journey too: Pi needs configured auth to show available models even offline. It does not prove login. Network calls can refresh that copy and consume real plan quota. Do not use API keys, fabricate credentials, or silently substitute a fake provider. Google/browser interaction requires the account owner's participation. Project overrides `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT_ID` are read only during login; do not add a guessed project.

## Doctor

Run `python3 "$HELPER" doctor "$EVIDENCE"` first whenever anything looks off. This checks installed Pi version, unchanged extension source, correct scratch directories, source-profile hashes, and Google OAuth presence/expiry/project booleans without printing credentials or refreshing tokens. An empty profile is healthy for login/no-models checks; offline selection needs configured OAuth, and requests need a project and an unexpired credential (or a successful real refresh). This is a local prerequisite check, **not a claim that Google accepts the account**. The original source profile is taken from `init`'s manifest, not the managed job's overridden `PI_CODING_AGENT_DIR`.

For an already launched TUI, also use `tmux_jobs list` and capture its owned pane: require the same job still running and the expected model/footer. A stale pane or another session is not a healthy instance. If doctor reports another Pi version, stop and revalidate flags before changing this skill's compatibility gate.

## Drive

Use native commands, never internal setters. Get `INPUT` as the `scratch` value in `state.json` plus `/tui.input`; the PTY wrapper creates this mode-0600 FIFO. Keep the literal absolute value across calls. With the recorded socket flags in each tmux command:

```sh
tmux capture-pane -p -t "$TARGET" -S - > "$EVIDENCE/01-ready.txt"
printf '%s\n' '/model + Enter' >> "$EVIDENCE/actions.txt"
printf '/model\r' > "$INPUT"
```

`printf 'google-oauth-v2' > "$INPUT"` searches the open model selector. Input is bytes into the actual terminal, not injected application state. Special-key recipes: `printf '\r'` Enter; `printf '\033'` Escape; `printf '\014'` Ctrl+L; `printf '\033[Z'` Shift+Tab; `printf '\033[B'` Down (each redirected to `"$INPUT"`). Use fixed format strings; never interpolate credentials into shell commands.

Capture after each action and wait for the concrete feature-map text before continuing (bounded polling, e.g. 20 seconds). Do not combine opening a selector and typing its search without observing that the selector opened. Search by provider/model label, not fixed arrow counts. Record action, key and resulting state for every mapped entry point tested.

For CLI prompts the helper records argv, stdout, stderr and exit status:

```sh
python3 "$HELPER" run "$EVIDENCE" -- --provider google-oauth-v2 --model gemini-3.8-flash --thinking medium --no-tools --print 'Reply with exactly GOOGLE_VERIFY_OK and nothing else.'
```

This requires real login and makes a live request. Read both output files; exit `0` alone does not prove the model answered. See the feature map for exact expectations and the existing live probe.

## Evidence

Default location: `<repo>/.audit/verify-pi-google-oauth-v2/evidence/<run-id>/`, **outside scratch and outside the normal agent profile**. This checkout ignores `.audit/` via its local Git exclude; do not commit raw artifacts or credentials. Keep this path in the final report. Save a `result.md` naming feature/sub-feature IDs, entry points exercised, preconditions, assertions, and VERIFIED / NOT VERIFIED / INCONCLUSIVE outcomes; never upgrade an unattempted path to a pass.

- Exercise the real user path. Native model picker proof is not supplied by a mocked registry or unit tests; copied credentials are not login proof.
- Capture the action **and** resulting pane, CLI response or native event stream. Include visible app/model identity. Capture the selected footer after closing the picker, not just the open menu.
- Verify side effects independently: auth presence/expiry/project booleans after login, catalog cache file existence after refresh, actual read-tool results and replay in the existing live probe, source-profile hashes and scratch removal at cleanup. Do not dump `auth.json`, raw headers or request bodies.
- `--offline` disables automatic network work; it is **not** a general network sandbox or a dry-run of a user prompt. Never send a live prompt and claim no network from the flag's name. If verifying a no-network claim, separately observe attempted connections with a suitable network observer and record its scope; this helper does not provide such evidence.
- No mocks are used by these journeys. A blocked Google/browser boundary is an unmet precondition, not permission to invent a successful response. Record HTTP/provider errors faithfully, including 429; do not assert quota is unaffected.
- Login panes may contain OAuth URLs, state and codes. Do not pipe login panes indiscriminately to permanent artifacts. Keep a redacted action/outcome log, omit URLs/codes/tokens/account identifiers, and never upload unreviewed terminal or JSON logs. Private evidence directories are mode 0700. Managed jobs also keep their own raw `output.log`; login URLs/codes may appear there even when you omit pane captures. Keep that log private, redact before sharing, and never attach it wholesale to a login proof.
- No API-key request-safety claim follows from baseline discovery; credential routing needs dedicated network-attempt evidence if that is the task.

## Cleanup

After **every** attempt, including failures:

1. Capture final feature evidence. In the owned TUI send `/quit` + Enter and wait for the process to exit. Use `tmux_jobs stop` for the recorded managed job to release its terminal, or to terminate a stuck run. The PTY wrapper terminates only its own process group in `finally` and removes its input FIFO. Never kill by process name. Stop only this run's jobs, not other verification jobs.
2. Then run `python3 "$HELPER" cleanup "$EVIDENCE"`. It refuses to remove scratch while its recorded TUI launcher is still alive, deletes the exact scratch tree from `state.json`, and writes `cleanup.json` outside it. If a managed stop is still terminating processes, wait for exit and retry. Investigate changed source-profile hashes; concurrent normal Pi activity can change them too. Never restore old credentials over a concurrently updated profile.
3. Confirm retained proof: `test -s "$EVIDENCE/state.json" && test -s "$EVIDENCE/cleanup.json"`, inspect `scratchRemoved: true`, `sourceProfileUnchanged: true`, and verify the feature artifacts and `result.md` still exist. Evidence is **never** deleted by this helper.

Run IDs, profiles and working directories isolate simultaneous runs. Google login listeners bind an ephemeral loopback port; browser account state and remote quota are shared external boundaries. Do not run concurrent sign-ins against the same browser/account, or double-drive a shared TUI. Refreshing a copied token can still affect its remote validity; isolation does not clone the account.

## Helpers

Executable `scripts/verify.py` (Python standard library only):

- `init EVIDENCE` creates scratch and a durable manifest; evidence must not already exist.
- `doctor EVIDENCE` reports safe local health without network or credential refresh.
- `copy-auth EVIDENCE` optionally copies just the source profile's Google OAuth entry.
- `run EVIDENCE -- PI_ARGS...` runs the real CLI, timeout 180 seconds, records command/stdout/stderr/exit code, returns the CLI status (124 on timeout).
- `serve-tui EVIDENCE -- [--offline]` runs a real 140x40 PTY under `tmux_run`. Input goes to its scratch `tui.input` FIFO; output is captured from the managed tmux pane. It does not need to bind another tmux socket in the sandbox.
- `tui EVIDENCE -- [--offline]` is the wrapper's inner launcher; only invoke directly from an already interactive terminal. No tools enabled.
- `live EVIDENCE` runs the repo's existing `extensions/pi-google-oauth-v2/scripts/verify-live.ts` through Bun (30-minute outer timeout; each native child has a 180-second timeout). It makes live Google requests, creates/removes its own additional temporary profile, and retains summary stdout/stderr/exit here. See [instruction and tool replay](features/instructions-and-tools.md).
- `cleanup EVIDENCE` removes this run's scratch only, retaining proof and a cleanup report.

After adding/editing this skill, run `/reload` in the agent session that will use it. Maintain the feature map with `/skill:maintain-verification-skill` as behavior changes.
