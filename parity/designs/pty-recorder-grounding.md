# PTY recorder grounding

## User path and ownership

The operator starts an installed CLI on a terminal, enters literal keys, observes streamed terminal bytes, changes geometry, and exits or interrupts. A recorder must retain dispatch intent separately from observed bytes and exit. It owns only a unique attempt directory and its spawned process tree. It must not write acceptance definitions, passing requirement flags, model identity claims, or runtime workflow state.

## Existing call paths traced

- `.pi/skills/verify-pi-customizations/bin/control-pi`: `main` → `drivePstackStatus` → `createRpcSession` → `spawn('pi', ['--mode','rpc',...])`. `send` correlates response IDs; the status drive gets messages after a handled command and writes status/todos to caller-supplied output paths. The child uses pipes, not a PTY. The output parser silently ignores malformed JSON. No terminal bytes, key timing, rendered screen, package digest or paired Cursor run is captured. `close` closes stdin then kills the single child after five seconds. This remains a narrow supporting RPC smoke, not a terminal recorder.
- `extensions/pi-pstack/test/routine-secret-pty.py`: argument parsing → `pty.fork` → child `os.execv` → parent `select`/`os.read` loop → prompt detection → `os.write` or SIGTERM → `waitpid`. It verifies secret echo state in a test-only fixture. It accumulates bytes in memory and discards timing/order. It does not record resize or generalize to user journeys. It must not be repurposed for credential capture.
- `parity/scripts/check-preflight.mjs`: `runPreflight` → `inspectParity` → BLOCKED diagnostics. It never writes completion or acceptance. Recorder output must remain supporting evidence, not a flag that bypasses this boundary.
- `parity/evidence/cursor-first-run/`: preliminary raw output and screen snapshots exist, but complete per-action timestamps, artifact bindings and paired identity are absent. Do not overwrite them or retrospectively invent timestamps.
- Pi 1.1.0 CLI docs: interactive UI requires terminal stdin/stdout; redirected IO selects print mode. Print and JSON are one-shot; RPC is long-lived, but cannot prove terminal UI. Actual launch must attach all standard streams to a slave terminal and provide rows/columns before exec. Pi owns its UI and agent loop. A test recorder must not reimplement either.

## Proposed first slice

Use real PTYs for public non-credential controls. Record ordered launch, start, bytes, write acknowledgements, geometry, cancellation and exit with monotonic and UTC timestamps. Retain every failed/interrupted attempt; no automatic passing verdict. Exercise a real fixture first: isatty, initial geometry, raw invalid UTF-8, input, resize, immediate exit, missing executable and descendant cancellation. Then record installed Cursor/Pi non-model controls. Platform coverage is explicitly incomplete until equivalent Windows controls are built and exercised.

## Architect phases

1. Ground: this traced model and shared frame.
2. Sketch: two isolated native Pi print processes produce structural alternatives.
3. Agree: synthesis follows completed sketches and a separate critique; no human checkpoint requested.
4. Implement: RED/GREEN tests for recorder contracts, not acceptance-oracle changes.
5. Scrap: revisit design if process lifecycle or evidence ownership needs repeated escape hatches.

Configured architect runners are `inherit-parent`. Two seats use the parent's configured OpenAI model in independent processes. That is worker independence, not model-family diversity. Independent different-family review remains a separate requirement and cannot be claimed from the seats' names.
