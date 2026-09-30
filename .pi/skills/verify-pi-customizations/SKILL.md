---
name: verify-pi-customizations
description: "Verify user-facing Pi CLI and RPC behavior for pi-customizations extensions and skills: pstack status and todos, poteto mode persistence, standalone skills discovery, and OAuth subscription models. Use before shipping or after changes to runtime behavior."
---

# Verify pi-customizations

Drive `pi-customizations` packages and extensions through the real Pi CLI and RPC interface the way a user does, capturing proof artifacts without mock side-effects.

## Launch

For verification, Pi runs in RPC mode with `--no-session` and `--no-extensions`, loading the target package explicitly via `-e <package-dir>` inside an isolated temporary directory (`PI_CODING_AGENT_DIR` set to a disposable scratch directory).

Exact launch command:
```bash
pi --mode rpc --no-session --no-extensions -e <package-dir>
```

Ready indicator:
- The Pi process starts listening on stdin/stdout. Sending `{"id":"1","type":"get_commands"}` receives an immediate response with `{"id":"1","type":"response","command":"get_commands","success":true}`.

Teardown:
- Close process stdin (`child.stdin.end()`), wait up to 5 seconds for normal exit, and issue `SIGKILL` only if the child fails to terminate. Remove the scratch directory.

## Doctor

Run the read-only doctor command before any verification run to confirm the host environment is sound:

```bash
./.pi/skills/verify-pi-customizations/bin/control-pi doctor
```

The doctor check verifies:
1. Node.js version satisfies engine requirements (`>= 22.19.0`).
2. The `pi` CLI binary is on `PATH` and executable (`pi --version`).
3. The repository root contains a valid `package.json` for `pi-customizations`.
4. Pi RPC starts and returns registered commands without extension or loader errors.

Exits `0` on success. If doctor fails, resolve environment issues before driving features.

## Drive

Drive features end-to-end using the project harness:

```bash
# Verify pstack status and todo reporting
./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-status

# Verify poteto mode off toggle and branch state entry
./.pi/skills/verify-pi-customizations/bin/control-pi drive poteto-mode

# Verify root standalone skills registration
./.pi/skills/verify-pi-customizations/bin/control-pi drive standalone-skills

# Verify OAuth subscription model providers
./.pi/skills/verify-pi-customizations/bin/control-pi drive oauth-providers
```

To choose a custom evidence directory for a supported feature drive:
```bash
./.pi/skills/verify-pi-customizations/bin/control-pi drive pstack-status --out artifacts/custom-status
```

## Evidence

Every drive captures user-observable evidence written directly to `artifacts/verify-pi-customizations/<feature>/`:

- **pstack-status:**
  - `status.txt` and `status.json`: complete pstack version, team-kit version, skill counts (65 skills, 64 prompt templates), and mode state.
  - `todos.txt`: output confirming todo list state (`Todos: none.`).
- **poteto-mode:**
  - `off.txt` and `off.json`: UI notification (`"Poteto mode is off."`) and appended branch state entry (`"pstack-state"`, `enabled: false`).
- **standalone-skills:**
  - `skills.txt` and `skills.json`: verified registration of `skill:doctor`, `skill:implement-cli-from-contract`, `skill:reverse-engineer-cli`, `skill:run`, and `skill:simplify`.
- **oauth-providers:**
  - `claude-models.txt`: table of registered `claude-subscription` models.
  - `antigravity-models.txt`: table of registered `google-antigravity` models.

Proof standards:
- All commands execute through real CLI/RPC calls, not unit test stubs.
- Evidence records action, responses, notifications, and branch state mutations.
- Proof artifacts survive cleanup.
- Coverage is limited to the mapped drives: status and empty todos, the mode-off notification and appended state, skill registration, and fixture-backed provider model listing. These drives do not prove restart persistence, workflow execution, OAuth login, or inference.
- Run doctor before each fresh drive and again after a failure. Check saved artifacts at their named paths after cleanup.

## Cleanup

Cleanup is strictly scoped to test instances:
- The harness tracks the child PID started for verification and terminates only that process. It never runs blanket process-killing commands like `pkill pi`.
- The temporary scratch directory (`/tmp/control-pi-*`) is completely removed in process exit hooks.
- Proof artifacts in `artifacts/verify-pi-customizations/` are preserved for review.

## Helpers

The verification skill provides `./.pi/skills/verify-pi-customizations/bin/control-pi`, an executable Node.js CLI script that encapsulates isolated environment setup, RPC lifecycle management, assertion checking, and evidence collection:

- `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`: environment and CLI readiness probe.
- `./.pi/skills/verify-pi-customizations/bin/control-pi drive <feature> [--out <dir>]`: runs mapped feature drives (`pstack-status`, `poteto-mode`, `standalone-skills`, `oauth-providers`).
