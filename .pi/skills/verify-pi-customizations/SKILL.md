---
name: verify-pi-customizations
description: "Verify user-facing Pi CLI and RPC behavior for pi-customizations extensions and skills: pstack status and todos, poteto mode persistence, standalone skills discovery, and OAuth subscription models. Use before shipping or after changes to runtime behavior."
---

# Verify pi-customizations

Drive `pi-customizations` packages and extensions through the real Pi CLI and RPC interface the way a user does, capturing proof artifacts without mock side-effects.

## Launch

For verification, Pi runs in RPC mode inside an isolated temporary directory with `PI_CODING_AGENT_DIR` pointed at a disposable scratch directory and the target package loaded explicitly via `-e <package-dir>`. `lib/rpc.mjs` owns the launch, spawns the real `pi` binary from `PATH` (override with `PI_BIN`), and appends every stdout record to a raw capture file as it arrives so a crash still leaves evidence.

Base launch args: `pi --mode rpc -e <package-dir>`, plus `--no-session` unless the caller opts into session persistence. A scenario that must observe restart persistence passes `persistSession` (and usually `sessionId`) to `startSession`, then calls `session.restart()` and reads prior state.

The client exposes a dialog bridge for `select`, `confirm`, `input`, and `editor` requests, a settle-aware `prompt(message)`, `waitForIdle`, enumeration helpers (`commands`, `messages`, `models`, `state`, `bash`), and a per-request deadline that names the timed-out request.

Teardown: `session.close()` ends stdin, waits up to 5 seconds for normal exit, and issues `SIGKILL` only to that child. The CLI removes only its own scratch directory.

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

Scenarios are modules under `scenarios/`. `drive <name>` loads `scenarios/<name>.mjs`, so a new scenario is a new file with no CLI edit; an unknown name reports the available scenario names. Each scenario asserts through `lib/receipts.mjs`, which writes the receipt and the assertion in one call, and the CLI exits nonzero when any receipt written during the run has verdict `failed`.

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

`--out <dir>` overrides the scenario artifact directory for receipts and raw captures.

## Evidence

Every scenario writes receipts and raw captures under `artifacts/user-perspective/<scenario>/`:

- `<surface_id>.json`: the receipt defined by `docs/user-perspective-testing/README.md`, with `head_sha`, `pi_version`, and `checked_at` filled in.
- `raw/`: the stdout capture the assertion ran against, written before the assertion, plus any CLI output a drive reads.

Surface coverage by scenario:

- **pstack-status:** `PS-CMD-4` (`/pstack status` and `/pstack todos` post `pstack-status` custom messages and report `Todos: none.`) and `PS-UI-8` (the status block reports the pstack and team-kit versions plus the bundled counts of 71 skills and 69 prompt templates). Raw capture `raw/rpc-1.jsonl`.
- **poteto-mode:** `PS-UI-5` (`/poteto-mode off` notifies `"Poteto mode is off."`) and `PS-CMD-1` (the command appends a `pstack-state` entry with `enabled: false`). Raw capture `raw/rpc-1.jsonl`.
- **standalone-skills:** `RS-SKILL-1` through `RS-SKILL-5` register `skill:doctor`, `skill:run`, `skill:simplify`, `skill:reverse-engineer-cli`, and `skill:implement-cli-from-contract`. Raw capture `raw/rpc-1.jsonl`.
- **oauth-providers:** `AN-PROV-1`, `AG-PROV-1`, and `XA-PROV-1` list provider models from the fixture `auth.json`. Raw captures `raw/claude-models.txt`, `raw/antigravity-models.txt`, and `raw/grok-build-models.txt`.

Proof standards:
- All commands execute through real CLI/RPC calls, not unit test stubs.
- Evidence records action, responses, notifications, and branch state mutations.
- Proof artifacts survive cleanup.
- Coverage is limited to the mapped surfaces: status and empty todos, the mode-off notification and appended state, skill registration, and fixture-backed provider model listing. These drives do not prove restart persistence, workflow execution, OAuth login, or inference.
- Run doctor before each fresh drive and again after a failure.

## Cleanup

Cleanup is strictly scoped to test instances:
- The harness tracks every child process it starts and terminates only those processes. It never runs blanket process-killing commands like `pkill pi`.
- The temporary scratch directory (`/tmp/control-pi-*`) is completely removed in process exit hooks.
- Receipts and raw captures under `artifacts/user-perspective/` are preserved for review.

## Helpers

The verification skill provides `./.pi/skills/verify-pi-customizations/bin/control-pi`, an executable Node.js CLI script, plus two libraries it loads:

- `lib/rpc.mjs`: generic RPC session client (real `pi` child, raw capture, dialog bridge, settle-aware prompting, restart, enumeration, per-request deadlines).
- `lib/receipts.mjs`: receipt writer and validator; `assertVerdict` writes a `verified` or `failed` receipt from a real assertion.
- `scenarios/<name>.mjs`: one module per scenario, default-exporting an async function that takes the CLI context.
- `control-pi doctor`: environment and CLI readiness probe.
- `control-pi drive <name> [--out <dir>]`: runs the matching scenario.
