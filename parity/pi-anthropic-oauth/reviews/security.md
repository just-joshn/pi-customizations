The ambient-token reorder did not break cancellation or credential storage. The remaining issues are an extra environment credential source, a session-scoped guard race, and unredacted failure text written into the session.

## Secrets in fixtures and errors

No live access tokens, refresh tokens, or authorization codes appear in the named fixtures or in the auth errors this package throws.

- `parity/pi-anthropic-oauth/fixtures/credential-precedence.json` records only variable names, schemes, and exit codes. The `not_measured` list does not include token material.
- `parity/pi-anthropic-oauth/fixtures/oauth-login-observation.json` records the public OAuth client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, scopes, and redirect shapes. That client id is not a bearer or refresh token. The fake exchange result is a status line, not a code or token body.
- `extensions/pi-anthropic-oauth/test/auth-boundaries.test.ts` uses labeled synthetics (`sk-ant-oat01-auth-token-wins`, `sk-ant-oat01-setup-token-loses`, `sk-ant-oat01-oauth-alias-loses`, `sk-ant-oat01-other`) and the fake body field `sensitive-server-value`. `test/support/credentials.ts` builds `OAUTH_ACCESS_TOKEN` as `sk-ant-oat01-` plus a runtime `randomUUID()`, not a captured credential.
- `tokenAuth` rejects a non-matching value without interpolating it (`extensions/pi-anthropic-oauth/src/auth.ts` lines 7–10). Login and refresh failures are replaced with fixed strings after an abort check (`auth.ts` lines 32–36 and 43–49). The state-mismatch test expects that generic login error and an empty token-endpoint log (`auth-boundaries.test.ts` lines 126–136). The failed-refresh test expects the store to stay unchanged, `env` not to be called, and `sensitive-server-value` not to appear (`auth-boundaries.test.ts` lines 144–155).

## Cancellation and storage after the order change

These boundaries still hold.

- Abort is checked before any credential or environment read, and again after every `ctx.env` await, including the new third variable (`auth.ts` lines 17–22). A token is not returned once the signal is aborted. The pre-env test also asserts `env` was not called (`auth-boundaries.test.ts` lines 78–85). The mid-read test aborts inside `env` and expects the abort reason (`auth-boundaries.test.ts` lines 87–96).
- A stored `credential.key` is resolved before the ambient loop (`auth.ts` line 18). The stored-over-ambient test expects source `OAuth` and zero `env` calls (`auth-boundaries.test.ts` lines 54–60). An empty stored key returns `undefined` from `tokenAuth` and does not fall through to the environment. An invalid stored key throws and also does not fall through. That is fail-closed, not an account switch.
- The wrapper does not write the store. A failed refresh still does not consult ambient tokens (`auth-boundaries.test.ts` lines 144–155). Login and refresh rethrow the abort reason via `throwIfAborted()` before the generic error (`auth.ts` lines 35 and 47; tests at lines 99–124). There is no path or command construction in these files.

Measured order among the variables Claude actually consults is preserved: `ANTHROPIC_AUTH_TOKEN`, then `CLAUDE_CODE_OAUTH_TOKEN` (`auth.ts` line 4; `credential-precedence.json` print-mode rows; tests at `auth-boundaries.test.ts` lines 20–39).

## Confirmed defects

1. Extra ambient credential source. `TOKEN_VARIABLES` still reads `ANTHROPIC_OAUTH_TOKEN` (`auth.ts` lines 3–4). The 2.1.296 fixture says that variable selects nothing and prints "Not logged in" (`credential-precedence.json` print-mode row 2 and auth-status row 3). Spec row 009–011 says to resolve the ambient aliases Claude consults (`parity/pi-anthropic-oauth/spec.md`). After the reorder this alias cannot beat the two measured variables, but if both are unset this client will authenticate a token the measured CLI ignores. The rejection path does not echo the value, so this is an authentication-boundary expansion, not a log leak. It is documented in the package README and covered as accepted behavior by `auth-boundaries.test.ts` lines 10–14 and 31–39, but it is not the measured CLI boundary.

2. Guard concurrency is process-global and the reset races an in-flight compaction. `inFlight`, `failureReported`, `bias`, and `cutReported` live in one `installContextGuard` closure (`extensions/pi-anthropic-oauth/src/context/guard.ts` lines 176–204). `session_start` and `session_shutdown` call `reset()`, which clears `inFlight` without invalidating the compaction already awaiting `compactOnce` (`guard.ts` lines 91–102 and 182–188). The in-flight handler's `finally` then sets `inFlight = false` unconditionally (`guard.ts` lines 163–165). A reload that starts a second compaction can therefore overlap the first, and the first completion can clear the second's flag. `ContextGuard.observe` has no generation check (`guard.ts` lines 199–202). `guardedStream` always applies a late result (`extensions/pi-anthropic-oauth/src/index.ts` lines 127–138), so a response that finishes after `session_start` can retune the new session's bias from the previous payload. This does not move credentials. It can double-compact or calibrate the wrong session.

3. Compaction failure reporting latches for the rest of the session. The first non-benign `onError` sets `failureReported` and later failures return without a report (`guard.ts` lines 140–146). `reset()` is the only clear, and it runs on session start or shutdown, not after a successful later compaction (`guard.ts` lines 182–188). The handler still resolves, so the request continues on the old projection (`guard.ts` lines 91–102). Recovery is silent after the first persisted warning.

4. Failure text is persisted without redaction. Compaction failures are appended as `compaction failed: ${error.message}` (`guard.ts` lines 144–146 and 52–58, wired from `index.ts` lines 164–167). Fit failures are appended the same way, including `String(error)` for non-Error throws (`guard.ts` lines 192–195). Nothing in this package puts a token in those strings today. The sink will store whatever message Pi's `compact` callback supplies, in the session via `appendEntry`.

5. Summarization fitting is a substring test. `isSummarizationRequest` is true when any system text contains `"summarization assistant"` (`extensions/pi-anthropic-oauth/src/context/fit.ts` lines 148–154). That selects `fitSummarization`, which rewrites the single user message and can drop its middle (`fit.ts` lines 92–116). A normal request whose system prompt happens to contain that phrase is truncated on the wire. The session history is not written back, but the outgoing payload is. This is a state-integrity miss, not command injection.

## Suspicions

- `x-claude-code-session-id` is set from `options.sessionId` with no CR/LF or control-character check (`index.ts` lines 78–81). Normal Pi session ids are not attacker header material. A caller-supplied id with newlines would depend on the HTTP client for header injection. Not demonstrated here.
- `withUniqueToolNames` casts `tool.name` to `string` and calls `toLowerCase()` (`index.ts` lines 48–56). A non-string name throws out of `onPayload`. The comment says Pi's conversion always supplies a string. That is an unvalidated boundary, not a proven crash.
- `compactOnce` does not take the request abort signal (`guard.ts` lines 91–102). OAuth login and refresh preserve abort. A cancelled turn can still commit Pi's compaction summary. Whether that is observable depends on the host, not on these tests.
- `before_agent_start`'s outer `catch` discards the error without reporting it (`guard.ts` lines 160–162). An estimator throw such as `Unhandled agent message: ${serialized(...)}` in `tokens.ts` would be swallowed there, while a fit throw would be persisted. Inconsistent, and the serialized form could contain message text if that path ever reached `report`.
- `observed` is cleared at the start of `onPayload` and set only after the caller hook returns (`index.ts` lines 87–93 and 114–138). If the host settled `result()` between those points, `observe` would see `undefined` and skip calibration. That would under-compact later, not leak the payload.

## Not found

No path joins, shell commands, or `child_process` usage in the named files. Fitting and billing build new objects and do not write the transcript (`fit.ts`; `index.ts` `withBillingBlock`). Ambient resolution never calls the credential store. Login and refresh errors from this wrapper do not include the authorization code or the mock refresh token.
