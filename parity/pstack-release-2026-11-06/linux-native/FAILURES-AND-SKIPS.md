# Failures and skips — BLOCKED

Source: `544e2deb2cf4c404a8be1c3dc5afc2b79b21bc90`. No source, assertions, sandbox policy, test exclusions, or worker settings were changed.

## Final unprivileged full suite

**827 passed, 9 failed, 7 skipped** out of 843 tests; 59 passing, 5 failing, 3 skipped files. All nine remaining failures need a working readonly sandbox; this container refuses bubblewrap namespace creation. They are recorded as failures, not converted to skips.

1. `test/linux-readonly-sandbox.test.ts` — **read-only commands and network reads run, while writes and Unix sockets are refused (G12)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected '' to contain 'RO-MARK'`
2. `test/readonly-shell-security.test.ts` — **a shared pre-initialized sandbox policy does not weaken the shell (TASK-019)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected 'ERROR: no verified OS sandbox is avai…' to match /Operation not permitted|Read-only fil…/`
3. `test/readonly-shell-security.test.ts` — **the dependency default write paths stay denied (TASK-019)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `Error: no verified OS sandbox is available: bubblewrap could not start the read-only sandbox: bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.`
4. `test/readonly-shell-security.test.ts` — **an inherited BASH_ENV startup file never runs outside the sandbox (TASK-019)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `Error: no verified OS sandbox is available: bubblewrap could not start the read-only sandbox: bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.`
5. `test/readonly-shell-security.test.ts` — **an already-aborted call never spawns the command (TASK-019)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `Error: expected [Function] to throw error matching /aborted/i but got 'no verified OS sandbox is available: …'`
6. `test/readonly-shell.test.ts` — **a process that used the shell exits on its own once its session shuts down**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected '' to contain 'SANDBOXED'`
7. `test/e2e/package.e2e.test.ts` — **installs from a fresh copy without node_modules, then removes cleanly (PKG-001)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected 'This is the output of the subagent:\n…' to contain 'Read-only file system'`
8. `test/e2e/task.e2e.test.ts` — **subagent types a readonly child runs git log and network reads but cannot write files (TASK-019, G12)**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected 'RESULTS:\n[bash error] no verified OS…' to contain 'RO-COMMIT-MARK'`
9. `test/e2e/task.e2e.test.ts` — **subagent types readonly children still inherit environment credentials**
   - BLOCKED: bubblewrap namespace creation refused by this container.
   - First failure line: `AssertionError: expected 'This is the output of the subagent:\n…' to contain 'FAKE-BENNY-CREDENTIAL'`

## Skipped tests (existing predicates, unchanged)

- `test/readonly-shell-dependency.test.ts` — missing Unix socket isolation prevents the readonly command from running
  - macOS sandbox-runtime-specific test is intentionally skipped on Linux.
- `test/e2e/cloud-machine.e2e.test.ts` — cloud agents on a container machine (needs a Docker engine with node:22.22.2-bookworm and a LAN address) runs the agent on its own container with a fresh clone of the pushed remote, and the agent pushes its branch (G1)
  - Docker executable/engine and required image are not available in this runner.
- `test/e2e/cloud-machine.e2e.test.ts` — cloud agents on a container machine (needs a Docker engine with node:22.22.2-bookworm and a LAN address) a resume boots the stopped machine and continues the same agent there (G1)
  - Docker executable/engine and required image are not available in this runner.
- `test/e2e/cloud-machine.e2e.test.ts` — cloud agents on a container machine (needs a Docker engine with node:22.22.2-bookworm and a LAN address) the agent's file tools act on the machine: only the clone and the workspace's shared Project folders reach the host (G1, G2)
  - Docker executable/engine and required image are not available in this runner.
- `test/e2e/cloud-machine.e2e.test.ts` — cloud agents on a container machine (needs a Docker engine with node:22.22.2-bookworm and a LAN address) a background cloud agent keeps running after its chat closes, and the reopened chat gets its result (G1, G13)
  - Docker executable/engine and required image are not available in this runner.
- `test/e2e/cloud-machine.e2e.test.ts` — cloud agents on a container machine (needs a Docker engine with node:22.22.2-bookworm and a LAN address) a cloud agent's own subagent runs on the same machine and never receives the Slack token (G1, G3)
  - Docker executable/engine and required image are not available in this runner.
- `test/e2e/video.e2e.test.ts` — a video attachment reaches the subagent as timestamped frames (G8, needs ffmpeg)
  - ffmpeg is not installed; optional video test skips itself.

## Earlier failures and resolved verification setup issues

- Initial root suite: **824 passed, 12 failed, 7 skipped**. Besides the nine sandbox-blocked tests, two worktree-audit settings tests failed without `jq` and the run-lock chmod test failed as root. `extensions/pi-pstack/README.md:102` explicitly declares `jq`. After installing it and running as existing UID 65534 (`nobody`), the unchanged `records.test.ts` and `scripts.test.ts` both pass: **39/39**. The full rerun confirms those three failures are gone.
- Narrow positive readonly suite: **3 passed, 2 failed**. The expected `RO-MARK` and `SANDBOXED` output never appears because the sandbox cannot start.
- `12-unprivileged-narrow-launch-failure.log` and `13-unprivileged-full-launch-failure.log`: exit 127 before tests started because `/usr/sbin` was intentionally absent from the restricted PATH. Corrected by invoking the already-present `/usr/sbin/runuser` by absolute path. No assertion or product change.
- `17-packaged-readonly-probe-launch-failure.log`: the added evidence driver initially left JSON-mode stdin open; Pi waited for EOF and the 60-second process deadline fired. The evidence-only driver now closes stdin, consistent with the existing e2e harness. `18-packaged-readonly-probes.log` is the corrected run and records the actual namespace blocker.
- Clean npm install emitted a `node-domexception` deprecation and npm 11.20 lifecycle-approval warnings for `@google/genai` and `protobufjs`. No approval override was applied. The clean discovery and child execution assertions still passed.

## Packaged readonly checks

- Actual installed Pi JSON mode ran a readonly Task with positive file and loopback HTTP reads, followed by a forbidden file write. All three shell calls returned the explicit sandbox-unavailable error.
- Positive file/network reads: **BLOCKED**, not PASS. The positive-read assertion remains a hard failure (exit 1). The local HTTP server was never reached and the forbidden output file does not exist. This is fail-closed evidence only, not proof of working readonly execution.
- See `consumer-readonly-checks.json`, `consumer-readonly.stdout.jsonl`, and `18-packaged-readonly-probes.log`.

Full failure messages and all skipped test titles are preserved in `failures-and-skips.json` and the original Vitest JSON reports. The separate Java/TLC statechart script passed **367/367**, with zero failures or skips.
