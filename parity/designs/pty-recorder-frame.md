# PTY recorder design frame

## Scope

Build supporting recording infrastructure, not a comparator or acceptance gate. Its consumers need reproducible recordings of actual terminal processes and literal user controls. Maintainers need retained interrupted attempts and a small, testable boundary. Model identity authentication, external custody, protected scenario approval and parity judgments remain separate obligations.

The existing preliminary action logs lack complete per-action timestamps, raw ordered input/output records, resettable fixture digests and a full deployment binding. A how explainer is grounding the existing collection/preflight boundary before architectural alternatives are commissioned.

## Data shape before logic

One attempt owns one output directory and one event stream. No writer shares a stream with another attempt.

Separate these records rather than using completion booleans with optional fields.

- Attempt identity binds a unique attempt id, side, declared scenario/fixture references, terminal geometry, executable and installed-artifact fingerprints, public launch parameters, and observed environment.
- Ordered events distinguish launch intent, actual process start, output bytes, input dispatch, resize, cancellation request, errors and actual process exit. Record monotonic time and UTC observation time with every event. Requested execution and observed liveness are different events.
- Terminal outcome distinguishes exited, signaled, launch-failed, cancelled and interrupted/unsealed. No outcome carries a parity verdict.
- Sensitive credential entry is outside the first slice. Never record private environment values, login input, credential-bearing arguments or secret-request values under a claim of safe public evidence.

Raw terminal bytes and event ordering must remain recoverable. Any decoded or rendered view is derived, not the only recording. Terminal-generated replies are distinct from literal user actions.

## First-slice caller exercise

Start a real non-model terminal program in an owned resettable fixture. Observe isatty, initial dimensions, exact input/output bytes, resize and real exit. A second run must have a separate output directory. Exercise immediate exit, missing executable, cancellation and interruption without erasing the dispatch record or previous attempt. Then use the selected recorder for actual installed CLI non-model discovery controls. Neither exercise authorizes parity.

## Selection rubric

1. Byte and action fidelity. Preserve invalid UTF-8, split multibyte output, terminal replies and literal inputs without silently decoding away differences.
2. Lifecycle integrity. Retain dispatch/start/exit distinctions, immediate failures, cancellation, final output drainage and interrupted attempts.
3. Scope safety. Confine writes, reject symlink output targets, avoid credential capture, and refuse reuse of an attempt directory.
4. Artifact traceability. Bind the actual executable, installed payload, fixtures, geometry and relevant public environment without asserting external authentication.
5. Operational fit. State supported reference platforms, dependencies and native terminal protocol constraints. Unsupported branches remain open rather than being silently exempted.
6. Reader load and proof. Prefer the smallest usable API and test the real PTY with independent literal expected values. Keep acceptance and comparison out of the recorder.

The candidate task brief will describe the same required artifact to both designers. Candidate-specific structural constraints will produce two alternatives. Candidates must use the architect rationale template and screen the design-red-flags reference. Cross-judging starts only after both artifacts are complete. No implementation begins before synthesis and the synchronous rubber-duck critique.
