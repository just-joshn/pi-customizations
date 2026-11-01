# Pause note 2026-10-31

State: pi-anthropic-oauth changes are in the working tree, uncommitted. Package tests (366), typecheck and `prove:paths` pass.

Done: cch attestation (src/attestation.ts, attesting-fetch.ts, request-session.ts), billing attribution fields, first-party betas and headers, custom base revoke/suffix, CLAUDE_CODE_OAUTH_CLIENT_ID, paste strings, credential file hardening, oauth-account.ts, docs, CHANGELOG, ledger update.

Not done:
- Real-wire capture and re-verification of pi-antigravity-oauth and pi-xai-oauth (agy is Go, grok is Rust; MITM trust of the probe CA is unproven).
- `bun run ci` and `make verify-oauth` full run.
- Nothing is committed.
- Biome --write reformatted the anthropic files I edited. Unrelated files were reverted.
- Probe tooling is in /tmp/cch and is lost on reboot. The fixture test/fixtures/claude-cch-2.1.316.json is in the repo.
