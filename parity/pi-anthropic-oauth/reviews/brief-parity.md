You are an independent parity reviewer. Do not edit files. Read the files named below and write a review to stdout.

Focus only on parity coverage: missing behaviors, untested combinations, and tests that could pass without the behavior they claim.

Read:
- parity/pi-anthropic-oauth/spec.md
- parity/pi-anthropic-oauth/ledger.json
- parity/pi-anthropic-oauth/decisions.md
- parity/pi-anthropic-oauth/fixtures/oauth-login-observation.json
- parity/pi-anthropic-oauth/fixtures/credential-precedence.json
- extensions/pi-anthropic-oauth/src/auth.ts
- extensions/pi-anthropic-oauth/src/identity.ts
- extensions/pi-anthropic-oauth/src/index.ts
- extensions/pi-anthropic-oauth/docs/claude-oauth-parity.md

Cite file paths and line numbers. Separate confirmed defects from suspicions. Do not treat a passing target test as source parity unless the ledger evidence is a source observation. The claimed verdict is NOT VERIFIED. Say whether any VERIFIED row is too strong, and whether any NOT VERIFIED or INCONCLUSIVE row is missing.
