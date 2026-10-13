# Uncommitted pstack security/state review

Reviewed against HEAD on 2026-10-13. Focus: `extensions/pi-pstack/src/readonly-shell.ts`, `child-env.ts`, `index.ts`, `task/runner.ts`, and `task/tool.ts`. Read `extensions/AGENTS.md`. Source files were not edited. No proprietary Cursor implementation was inspected. Installed open-source Pi 1.2.0 and sandbox-runtime 0.0.79 were inspected. Local probes used disposable markers and cleaned them up; no model/API calls were made.

## Confirmed defects

### 1. High: inherited Bash startup environment executes outside the sandbox

**Location:** `extensions/pi-pstack/src/readonly-shell.ts:54–56`; inheritance at `src/task/tool.ts:120–123`.

`wrapWithSandbox()` produces a command that launches sandbox-exec, but pstack first launches an ordinary, unsandboxed `bash -c` with the inherited tool environment. Noninteractive Bash evaluates `BASH_ENV` before executing that wrapper. Pi's installed `dist/core/tools/bash.js:135–160` copies `getShellEnv()`, and `dist/utils/shell.js:115–125` retains process environment variables; neither strips `BASH_ENV`.

**Reproduced on macOS:** set BASH_ENV to a temporary startup file containing `printf escaped > <temporary marker>; unset BASH_ENV`, register the actual readonly tool, then execute `printf sandbox-command`. The tool returned `sandbox-command`, exit 0, and the startup file successfully wrote a marker outside the permitted sandbox paths. The next probe confirmed an ordinary write to such a directory is denied when BASH_ENV is absent.

This is a real boundary bypass, conditional on the inherited environment containing the startup hook. A model cannot set its outer shell's BASH_ENV merely by assigning it inside an already-sandboxed command. However, startup-file content may itself be attacker-controlled, and the current policy's writable shared paths give a readonly child places to alter such content if referenced by an inherited hook. PATH-based resolution of the outer `bash` is another exposed pre-sandbox boundary, but was not separately reproduced.

**Direction:** launch the sandbox directly through an absolute executable path, without an unsandboxed startup-capable interpreter; sanitize startup/environment hooks and executable resolution before any outer interpreter runs.

### 2. High: empty allowWrite still permits persistent writes to shared temp/home paths

**Location:** `src/readonly-shell.ts:10–15,30,54`; false contract at `src/task/tool.ts:34–35`.

Sandbox-runtime automatically prepends writable defaults even when `allowWrite` is empty. Installed dependency `dist/sandbox/sandbox-manager.js:1325–1346` adds `getDefaultWritePaths`; `dist/sandbox/sandbox-utils.js:485–544` includes `/tmp/claude`, `/private/tmp/claude`, `~/.npm/_logs`, and `~/.claude/debug`, in addition to device paths. The supplied empty deny lists exclude none of these.

**Reproduced:** the actual readonly tool denied `printf escape > <fresh OS temporary directory>/blocked` with Operation not permitted, but `mkdir -p /tmp/claude; printf allowed > /tmp/claude/pstack-review-<pid>` succeeded, exit 0; the marker existed. The marker was removed afterward.

This directly violates `parity/pi-pstack-two/spec.md:247–249`, which explicitly promises writes in `/tmp` fail, and the tool description's claim that every file write is blocked. The shared writable directory also allows state modification affecting other processes; it is not a private per-command scratch area.

**Direction:** explicitly deny persistent writable defaults, verify precedence on each supported backend, and revise any claim that the chosen backend cannot actually enforce.

### 3. High, deployment-conditional: shared dependency policy can replace readonly enforcement

**Location:** `src/readonly-shell.ts:19,26–31,54,91–93`.

The adapter trusts the process-global SandboxManager singleton and calls `wrapWithSandbox(command)` without an explicit per-command policy. Installed dependency `dist/sandbox/sandbox-manager.js:450–458` returns from subsequent initialize calls without installing the requested policy; its public updateConfig also changes the global policy.

**Reproduced:** in one process, initialize the same installed SandboxManager with a writable temporary directory, then register/invoke pstack's readonly bash. A write in that otherwise-blocked directory succeeded and its marker existed. Pstack's initialize did not replace the earlier policy.

An independently loaded extension must share the same physical dependency instance for this specific route; separate copies do not share the singleton. This is not proof that an existing extension in this workspace does so. Nevertheless, the adapter does not uphold its guarantee under supported shared-instance use. Shutdown also calls reset on the shared singleton, potentially interfering with another consumer (this interference was not separately tested).

**Direction:** do not rely on mutable ambient singleton policy for a security guarantee; pass an immutable per-command policy where supported, establish ownership of shared initialization/reset, and verify network proxy policy as well as filesystem wrapping.

### 4. Medium: resume does not persist the raised readonly floor

**Location:** `src/task/tool.ts:114–117,143–149`; original state at `126–136`.

A writable agent resumed with readonly true runs restricted for that invocation, but start writes its record only for fresh agents. A subsequent resume without readonly uses the unchanged false record and enables unrestricted tools/shell again. Thus the comment that a call can add readonly but not lift it and `spec.md:176,191–192` are not satisfied across resumes.

**Evidence:** code-path confirmation: planResume computes `effectiveReadonly(record.readonly, params.readonly)`; no resume writes the result back. This state defect is pre-existing in HEAD, not introduced by this diff, but the changed shell path now uses the transient restriction. Also, recordedAgent retrieves today's definition, yet planResume does not include `agent.readonly` in the floor; changing a type to readonly does not constrain an older writable record. That second case is likewise code-confirmed, not runtime-probed.

The analogous raised depth is not persisted either. A depth-1 agent resumed by a subagent runs at depth 2, then may run at depth 1 when resumed by the main chat. Whether that is a defect depends on whether the intended floor is creation depth or maximum historical depth; the readonly floor requirement is explicit, whereas this depth interpretation is less certain.

**Direction:** persist monotonic readonly state under the run lock, incorporate current type restrictions, and clarify depth's intended persistence semantics.

### 5. Medium: cancellation already received during initialization is ignored until command completion

**Location:** `src/readonly-shell.ts:46–56,63–64,71–75`.

The adapter awaits sandbox initialization/wrapping and only afterward installs an abort listener. It never checks signal.aborted before spawning or immediately after listener registration. AbortSignal does not replay an earlier abort event.

**Reproduced:** call the actual readonly tool with an already-aborted signal and `sleep 1; printf ran-after-abort`. It ran for approximately 1067 ms, produced `ran-after-abort`, then threw `Command aborted`. The final status check reports cancellation but does not prevent the work. Cancellation occurring during the awaited setup has the same missed-event window.

**Direction:** check cancellation before/after awaited setup and before launching; register cancellation with an immediate aborted-state check and cleanup on every termination path.

## Confirmed integration limitations / conditional override route

**Location:** `src/task/runner.ts:36–40`, `src/index.ts:96`, `src/readonly-shell.ts:83–90`.

Readonly children load pstack explicitly but do not use `--no-extensions`; discovered/configured extensions still load. The allowlist filters names, not the implementation or read-only capability of a tool.

Installed Pi `dist/core/extensions/runner.js:410–422` explicitly uses the **first extension registration per name**, not last registration. `dist/core/agent-session.js:2846–2900` filters by allowed name and then substitutes registered extension definitions/executors for builtin names. Therefore an enabled extension overriding an allowed name such as `read`, `grep`, `find`, `ls`, or `TodoWrite` can run arbitrary in-process code despite the readonly tool list. An earlier `bash` registration can also win over pstack's wrapper if the actual load ordering places it first. Pstack's explicit CLI extension commonly has priority, so a blanket claim that any later bash registration wins would be incorrect.

This route is established from Pi's implementation, not a full child-process override reproduction. No malicious extension was found or asserted. Extensions are trusted OS-privileged code per `extensions/AGENTS.md`; readonly tool selection does not sandbox extensions, and sandboxing just Bash cannot prevent their writes/network/process activity. If the requirement includes resisting other extension overrides, the child must isolate resource loading and verify selected implementations rather than assume an allowed name is safe.

## Suspicions / not confirmed

- **Network escape in an otherwise clean invocation:** not established. Empty allowedDomains intends to deny network; BASH_ENV bypass can execute before that policy, and a shared mutable network policy is risky, but no network probe was performed.
- **Signaling arbitrary host processes:** not reproduced. Inspected macOS profile allows process-info and signal only for same-sandbox targets (`dist/sandbox/macos-sandbox-utils.js:712–715`). Do not infer an unrestricted macOS kill bypass. Linux process/IPC behavior remains untested.
- **Detached descendants escaping cleanup:** the adapter kills a process group on timeout/abort, but does not track detached child PIDs with Pi's normal shell helpers, nor kill surviving descendants on ordinary completion. Descendants that change process groups may outlive the call. Not reproduced; sandbox inheritance and escaping lifecycle cleanup are separate questions.
- **PATH / exported Bash function / loader environment wrapper manipulation:** the outer `spawn('bash', ...)` and generated command involve ambient executable/environment resolution. Only BASH_ENV was reproduced; no claim that every proposed environment variable bypasses the backend.
- **Temporary symlink attacks:** shared writable defaults are confirmed; an escape via symlink traversal to arbitrary denied paths is not. No destructive symlink test was attempted.
- **Current deployment's duplicate dependency or extension load ordering:** not exhaustively enumerated. The shared-instance policy bypass is reproduced, but a particular third-party consumer was not identified.

## Verification

- `cd extensions/pi-pstack && bun run test test/readonly-shell.test.ts test/task-runner.test.ts`: **2 files / 23 tests passed**.
- Existing readonly tests mock isSupportedPlatform false and check only description plus fail-closed behavior (`test/readonly-shell.test.ts:8–14,25–38`). They do not exercise real policy enforcement, startup environment, shared initialization, or cancellation races.
- Four separate real macOS probes: BASH_ENV unsandboxed write; default temp write versus denied ordinary directory write; prior singleton policy write; already-aborted command execution. Each used the actual registered tool. Temporary markers were cleaned up and SandboxManager was reset after each probe.
- No source changes, full suite, live model tests, or Linux verification performed. Report creation is the sole intentional repository write.

## Review axes

**Standards:** confirmed security guarantees exceed the actual OS policy, conflicting with `extensions/AGENTS.md` Security's instruction to use a real OS boundary rather than treat configuration as isolation; cancellation behavior also fails its verification requirements. Trusted extension execution is an explicit documented limitation, not itself a newly discovered exploit in Pi.

**Spec:** TASK-019's no-write guarantee fails on real macOS, and its fail-closed intent is bypassed before sandbox entry by Bash startup hooks. Resume's monotonic readonly floor fails as a pre-existing state defect. TASK-008 still says no shell while TASK-019 adds one; the newer requirement was used for this review.
