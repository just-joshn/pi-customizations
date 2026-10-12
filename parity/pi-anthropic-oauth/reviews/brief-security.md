You are an independent security and state-integrity reviewer. Do not edit files. Read the files named below and write a review to stdout.

Focus only on input boundaries, path and command injection, secrets, races, persistence, recovery, and failure handling.

Read:
- parity/pi-anthropic-oauth/spec.md
- extensions/pi-anthropic-oauth/src/auth.ts
- extensions/pi-anthropic-oauth/src/index.ts
- extensions/pi-anthropic-oauth/src/context/guard.ts
- extensions/pi-anthropic-oauth/src/context/fit.ts
- extensions/pi-anthropic-oauth/test/auth-boundaries.test.ts
- parity/pi-anthropic-oauth/fixtures/credential-precedence.json
- parity/pi-anthropic-oauth/fixtures/oauth-login-observation.json

Cite file paths and line numbers. Separate confirmed defects from suspicions. Check that fixtures and errors do not contain live tokens, and that cancellation and credential storage boundaries still hold after the ambient-token order change.
