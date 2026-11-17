---
name: verify-pi-pstack-v2
description: Drive the pi-pstack-v2 extension in the real Pi 1.5.2 terminal UI with an isolated profile and workspace. Use to verify bundled workflow discovery, model-role setup, sandboxed tmux jobs, Pi workers, wakeups, and write boundaries.
---

# Verify pi-pstack-v2

Read [features/README.md](features/README.md), then the feature being verified. The primary surface is **Pi's terminal UI**, with print mode as another entry point for tool-driven journeys. This package registers `pi_spawn`, `tmux_run`, and `tmux_jobs`, and bundled `/skill:…` workflows; its only slash command is `/pstack-mode`. Do not invent other `/pstack` commands or call module internals as user-path proof.

## Launch

Requirements: Pi **1.5.2**, Node >=22.19, Python 3, tmux, Bun; macOS Seatbelt (`sandbox-exec`) or Linux/WSL2 bubblewrap (`bwrap`). `gh`, `jq`, and `rg` are needed by some bundled workflows, not by the offline discovery journey. From the checkout root:

```sh
bun install --frozen-lockfile
bun run --filter @justjoshn/pi-pstack-v2 typecheck
HELPER="$PWD/.pi/skills/verify-pi-pstack-v2/scripts/verify.py"
EVIDENCE="$PWD/.audit/verify-pi-pstack-v2/evidence/$(date -u +%Y%m%dT%H%M%SZ)-$$"
python3 "$HELPER" init "$EVIDENCE"
python3 "$HELPER" doctor "$EVIDENCE" > "$EVIDENCE/doctor.json"
```

Keep the **literal absolute** `HELPER` and `EVIDENCE` values across tool calls; shell variables do not persist between tools. `init` creates a private scratch tree with sibling `agent/` and `work/` directories, initializes an empty Git repository, and seeds an outside-workspace sentinel. It records the checkout revision and package fingerprints in `state.json`. No build, migrations, server, seed account, or normal-profile installation is needed. Source is loaded directly through Pi's extension loader.

For the **credential-free discovery baseline**, launch the absolute equivalent of this command with `tmux_run`, a unique name, and a wake message:

```sh
python3 "$HELPER" serve "$EVIDENCE" > /dev/tty
```

Save its returned job ID, exact tmux socket (`-S` or `-L`), and target. Resize the owned pane to at least 170x60. With those recorded values:

```sh
tmux -S "$SOCKET" resize-window -t "$TARGET" -x 170 -y 60
tmux -S "$SOCKET" capture-pane -p -t "$TARGET" > "$EVIDENCE/01-ready.txt"
```

Wait up to 30 seconds for **`v1.5.2`**, `[Skills]` containing `poteto-help`, `poteto-mode`, and `setup-pstack`, `[Extensions]` containing `src`, and the scratch workspace footer. Read the capture, not just the exit code. A blank early capture is not readiness: poll again. Require no load errors or skill collisions. If startup was clipped before resizing, clear any draft, send `/reload` as text, observe it in the editor, then send Enter in a separate tool call. Wait for `Reloaded keybindings, extensions, skills, prompts, themes, and context files` and capture the now-readable resources/footer. **`Warning: No models available` and an `unknown` model footer are expected in an empty profile**; this is usable for command discovery, not AI tasks. Pi hides much startup detail behind Ctrl+O if the resources are not visible.

The helper owns a real 160x50 PTY and receives input via its private FIFO. Managed commands have no interactive stdin: use `send` below, **not tmux `send-keys`**. The explicit `> /dev/tty` is required for managed launches: it sends output directly to the owned controlling terminal instead of relying on the job wrapper's log mirror, which can produce a blank pane. `terminal.ansi` independently retains the unmodified terminal stream.

### Authenticated tool journeys

These need a real configured model and incur provider requests. The empty baseline deliberately has none. Do not substitute a fake provider, copied response, or direct tool `execute()` call.

Run a **fresh** `init` from an ordinary, unsandboxed terminal and launch `python3 "$HELPER" serve "$EVIDENCE"` in the foreground there, after arranging owner participation for `/login`. Drive it from another terminal with `send`. Use a built-in Pi provider; provider extensions are not loaded by this helper. Login alone does not prove any pstack feature. Never pass secrets through `send`: it records every input. Enter secrets/browser callbacks only through an owner-controlled secure path and keep login artifacts private. If that is not possible, report the auth precondition as unmet.

**Do not attempt live pstack job verification inside a `tmux_run`-hosted Pi.** That Pi inherits `PSTACK_V2_*` sandbox/broker markers from the host job; jobs can be brokered under the outer session rather than this disposable profile. Never unset those markers to bypass sandboxing. The managed baseline proves discovery only. `doctor` reports `sandboxedLauncher`; require `false` in the terminal hosting a live run. A shell launched by Pi's ordinary `bash` tool is not necessarily sandboxed: inspect this field rather than assuming.

The helper uses `--offline` to suppress automatic catalog/version work; explicit `/login` and model prompts can still use the network. After genuine login use `/model` to select the available model. No auth is copied from the user's normal Pi profile. Parent resource discovery is disabled except for this checkout's explicit extension and skill directory. Scratch settings also name these paths so spawned workers can load pstack. Workers use native Pi discovery and may additionally discover user-level `~/.agents/skills`; review startup diagnostics rather than claiming complete resource hermeticity.

Optional regression suite, **in an unsandboxed host terminal**, not through pstack's `tmux_run`:

```sh
bun run --filter @justjoshn/pi-pstack-v2 test
```

The suite starts actual sandboxes/tmux servers and creates temporary home-directory paths. Running it inside a pstack job causes nested-sandbox/home-write EPERM failures. Record command, environment, output and exit/timeout; do not relabel those as extension startup failures or as a passing suite. Unit/integration results support but do not replace terminal proof.

## Doctor

Run `python3 "$HELPER" doctor "$EVIDENCE"` first when anything looks off. It reads local version, package fingerprints, exact profile/workspace paths, sandbox/tmux availability, auth-file presence, launcher-record presence, and whether the current launcher shell is sandboxed. It does **not** refresh credentials, inspect secret values, prove provider acceptance, or assert the TUI is alive. Redirect its JSON into evidence when needed.

For a running baseline also inspect `tmux_jobs list` for the recorded job and capture **its owned pane**. Require the scratch footer and expected resource labels. A stale PID file or pane alone is insufficient. For live runs inspect `/model` and a real response to establish provider readiness. If source changed, clean up and initialize a new run. If the Pi version changed, revalidate CLI flags and UI handles before relaxing the version gate.

## Drive

Send literal terminal bytes through the executable helper. After the first capture, require both `skill:poteto-help` and `skill:poteto-mode`. After Ctrl+U, observe the empty editor before typing the next command. After the setup capture, require the model-role configuration description. Do not press Enter on that menu in the empty profile.

```sh
python3 "$HELPER" send "$EVIDENCE" '/skill:poteto-'
tmux -S "$SOCKET" capture-pane -p -t "$TARGET" > "$EVIDENCE/02-poteto-menu.txt"
python3 "$HELPER" send "$EVIDENCE" $'\025'
python3 "$HELPER" send "$EVIDENCE" '/skill:setup-pstack'
tmux -S "$SOCKET" capture-pane -p -t "$TARGET" > "$EVIDENCE/03-setup-menu.txt"
```

`send` appends timestamped input to `actions.jsonl`. Shell `$'…'` quoting supplies control bytes: `\r` Enter, `\025` Ctrl+U (clear text before cursor), `\033` Escape, `\017` Ctrl+O. Send one action, observe its concrete result, then continue. **Do not combine Ctrl+U, replacement text and Enter in one send.** Native input parsing can treat that burst differently and submit a prompt instead of the intended command. Type text first, capture/confirm it, then send `python3 "$HELPER" send "$EVIDENCE" $'\r'` in a separate tool call to submit. Poll for each expected label with a bounded deadline (20 seconds), not a fixed sleep. If the editor cursor is not at the end, Ctrl+U is not a whole-editor reset; clear the actual draft before typing a new command. Use stable command names and model/job labels, not arrow counts.

For live prompts use the exact requests in the feature files. Observe actual `tmux_run` / `pi_spawn` / `tmux_jobs` calls and their returned IDs in the UI/session transcript, not just the model's prose. The **host session's tools are not the tools under test**: do not call them yourself and attribute the result to the isolated TUI.

## Evidence

Durable location: **`<repo>/.audit/verify-pi-pstack-v2/evidence/<run-id>/`**, outside scratch. This checkout locally excludes `.audit/`; confirm with `git check-ignore` before retaining sensitive artifacts. The helper creates evidence mode 0700. Capture:

- `state.json`, `doctor.json`, `command.json`, `actions.jsonl`, unmodified `terminal.ansi`, and readable numbered pane captures before/after each action.
- `result.md`: feature/sub-feature IDs, every entry point attempted, unmet preconditions, concrete assertions, and VERIFIED / NOT VERIFIED / INCONCLUSIVE. Discovery does not verify workflow execution, workers, job lifecycle, setup writes, or safety.
- For live tools: copy relevant scratch `sessions/` transcripts and safe job `job.json`, `output.log`, `exit`, wake/stop markers, and worker answer transcripts **before cleanup**. Do not copy credential directories. Use the exact paths returned by the tools; the standard root is scratch `agent/pstack-v2/jobs/` only for an unsandboxed launcher.
- Independently observe mutations: read workspace output files, role config contents, branch/worktree state when applicable, and the outside sentinel after denied writes. Capture action **and** state; final assistant prose or an exit code alone is not proof.

Exercise real user paths, not internal setters or test-only endpoints. No mocks are required for these recipes. If an external model/login boundary is unavailable, record the failure rather than simulating success. `--offline` is **not a network sandbox or dry-run**: no no-network claim follows without separately observing attempted connections. For any safety/dry-run claim, observe files/network/git refs relevant to that claim instead of trusting the mode's name.

Live transcripts and managed `output.log` can contain login URLs/codes, prompts, account identifiers, and secrets. Review/redact before sharing; never dump `auth.json`, token values, or full copied job profiles. The helper's input log is another reason never to send secrets through it.

## Cleanup

After **every attempt**, including failures:

1. Preserve the feature artifacts, safe job logs, and `result.md` outside scratch. For live jobs, ask the isolated Pi to call `tmux_jobs` `stop` with the exact returned IDs; confirm all this run's jobs/heartbeat series stopped. **Interactive Pi shutdown does not stop its pstack jobs.** If the model is unavailable, use the owned socket and exact session IDs from its job specs to stop just those sessions; never kill by process name or kill another run's server. Do not erase live job specs.
2. Clear the editor with `send EVIDENCE $'\025'`, observe it empty, type `/quit` with `send EVIDENCE '/quit'`, observe that command, then submit with `send EVIDENCE $'\r'` in a separate tool call. Wait for exit, then stop the recorded managed job with `tmux_jobs stop` to release its resources (or stop a stuck wrapper). The helper's `finally` terminates only its child process group. A SIGKILL can prevent finalizers: inspect the recorded child PID if cleanup reports it still alive; do not delete the PID file merely to pass cleanup.
3. Run `python3 "$HELPER" cleanup "$EVIDENCE"`. It refuses while recorded launchers/children or recorded tmux sessions remain alive, deletes only this manifest's scratch tree, and writes `cleanup.json` outside it. Retry after termination completes. The report's `outsideUnchanged` is a single sentinel check, **not** proof of every sandbox boundary.
4. Confirm `scratchRemoved: true`, inspect `outsideUnchanged`, and run `test -s "$EVIDENCE/state.json" && test -s "$EVIDENCE/cleanup.json" && test -s "$EVIDENCE/result.md"`. Confirm the numbered captures and `terminal.ansi` also survived. Never remove evidence as part of cleanup.

Each run has its own profile, workspace, sessions and FIFO. No service port is needed. Real account quota/browser state remain shared; do not double-drive a TUI or concurrent sign-ins. Worktree recipes must create an initial scratch commit first; the empty baseline has no HEAD. Cleanup removes disposable repos/branches, not anything in the user's working checkout or normal agent profile.

## Helpers

Executable, Python-standard-library-only `scripts/verify.py`:

- `init EVIDENCE`: create a new private evidence directory, disposable profile/Git workspace, outside sentinel, and source manifest. Refuses an existing evidence directory.
- `doctor EVIDENCE`: read-only local health JSON (redirect to `doctor.json`); does not create/update instance state.
- `serve EVIDENCE`: launch real Pi in a PTY with explicit checkout resources. Managed tmux for offline discovery; unsandboxed foreground terminal for live tool journeys. Output is saved to `terminal.ansi`; input comes from scratch `input` FIFO.
- `send EVIDENCE TEXT`: send bytes to that FIFO and log action. Fails instead of blocking if no reader exists. Never use for credentials.
- `cleanup EVIDENCE`: verify no recorded live processes/jobs, remove scratch, preserve evidence and write `cleanup.json`.

After adding or editing this skill run `/reload` in the Pi session that will use it. Keep the feature map current with `/skill:maintain-verification-skill`.
