# Native implementation decisions

## Goal

Preserve the actual Cursor pstack contract through Pi-native code. This change implements the established shell-output-monitor unit. It does not establish a complete architecture for the unresolved hosted and IDE capabilities.

## Data and ownership

`ShellOutputWatch` owns one stream-monitor state machine. Its states are `watching`, `limited`, and `finished`. It owns the compiled pattern, bounded carryover, occurrence total, notification total, pending match batch, and batch timer.

The existing shell-job registry still owns processes, process groups, files, shell IDs, waits, and completion notices. Its stdout and stderr readers each own a UTF-8 decoder. Decoded text reaches both the output file and the monitor. Decoder tails flush before process completion.

The monitor emits structured notices with a sequence, title, and detail. The shell registry adds shell identity, tool-call identity, and output path. Existing Pi message and settle handling delivers the notices. Tests compare the structured monitor output with the original implementation and separately exercise actual Pi tool delivery.

## Alternatives considered serially

Keeping the monitor inline would avoid one module but leave regex, carryover, batching, and limit state mixed with process and file ownership. A separate module replaces the old line buffer and timer functions. It does not wrap or preserve those functions.

Executing the Cursor backend would preserve dependencies on Cursor and fail the native implementation requirement. The production code does not execute Cursor. Reference code executes only in the audit generator to create comparison evidence.

Copying an entire regex implementation would create a maintained fork. The published `re2js` 1.2.2 package matches the version identified in Cursor's shipped license. The dependency is pinned instead of substituting the current registry release. The reference generator checks the archive, engine-file, and captured-factory hashes.

Agent-based design exploration was prohibited by the operator. These alternatives were compared serially. No independent design-review claim is made.

## Installation and failure behavior

Pi local package installation does not install npm dependencies. A top-level, guarded `createRequire` lookup records whether the regex engine is available. Imports and module loading remain at module scope.

A missing engine does not prevent the extension or unrelated tools from loading. A valid requested watch throws a specific dependency error before the shell starts. That error bypasses the invalid-pattern fallback. This preserves monitoring intent rather than running the command without the requested protection.

An empty pattern creates no monitor. A malformed or oversized pattern logs a warning and leaves the real command running, as the original observer factory does. Constructor rejection and factory fallback have different tests.

## Verification boundaries

The source-driven fixture generator does not import pi-pstack. It extracts original classes from checksum-checked captured factories, uses the identified regex dependency, and controls timer and registry boundaries. The seeded confirmation run compares a separate set of inputs against those original classes.

Neither mechanism exercises Cursor's hosted backend, permissions service, whole shell executor, desktop UI, or model routing. The original observer's logging boundary is replaced for capture. Its registry records are collected rather than sent to a real Cursor conversation. Those limits remain explicit in the specification and final verdict.

The Pi CLI and RPC suites use an offline scripted model. Child Pi processes in these tests are deterministic test processes, not delegated LLM workers. The earlier mistaken `cursor agent status` call was a separate process-constraint breach and is not part of verification evidence.

## Unchanged unresolved mechanisms

This change does not turn local worktrees into remote cloud VMs. It does not make loopback routines hosted endpoints. It does not complete Slack automation setup, Cursor IDE integration, model-provider equivalence, owner-session isolation, shell permission parity, or cancellation during final-settle waits.
