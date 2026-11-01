# OAuth 100% parity program tracker

Exit predicate. For each of `pi-anthropic-oauth`, `pi-antigravity-oauth`, and `pi-xai-oauth`: oauth+deps ledger rows in consumer scope are VERIFIED against the installed CLI, Pi implements them with Pi mechanisms only, package tests and typecheck are green, and the package never shells to or loads the CLI binary at runtime.

Installed references.

- Claude Code `2.1.316` at `~/.local/share/claude/versions/2.1.316`
- Antigravity CLI `agy` `1.4.12` at `~/.local/bin/agy`
- Grok Build `1.0.70` at `~/.grok/bin/grok`

Prior landings on main. PRs 105 to 126 (version pins, native OAuth clients, loopback, 401 latch, credential imports, agy UA/keychain/onboard/tokeninfo, xai surface/referrer/prove, Claude revoke access and refresh, error strings, gated live exchange probe).

Decision trail. `.audit/oauth-parity-100-2026-10-31.tsv`

## Active PR queue (one owner each; verify then merge before next stack)

| PR | Unit | State | Next |
| --- | --- | --- | --- |
| #126 | ANTH-LIVE-021 gated live probe | MERGED `3ea621fb` | landed. Live acceptance still needs an operator run |
| #127 | ANTH-ALLOWLIST | MERGED `2f25719b` | landed |
| #128 | ANTH-FILE-LOCK | MERGED `99ae2cea` | landed. ANTH-FILE-LOCK closed |

## OPEN units after those land (from REMAINING-UNITS.md)

| ID | Package | Wire | Plan |
| --- | --- | --- | --- |
| ANTH-PROFILE | anthropic | low | Bearer GET/POST profile/validate/roles helpers + tests |
| ANTH-WINCRED | anthropic | low | wincred/libsecret readers for import |
| ANTH-COPY-025 | anthropic | low | Align paste/TTY notify strings to Claude carves |
| ANTH-BILLING-SUFFIX | anthropic | low | Add suffix only if Messages capture proves required |
| ANTH-CUSTOM-REVOKE | anthropic | low | Derive the revoke URL from the custom token URL |
| ANTH-CUSTOM-SUFFIX | anthropic | low | Use the `-custom-oauth` storage suffix for custom bases |

`pi-antigravity-oauth` and `pi-xai-oauth` OPEN counts are 0 for oauth+deps. AGY-SCOPE-ORDER closed evidence-only (Pi `SCOPES` already match measured consumer order).

## Workers this run

1. Verifier for PR #126 passed at `ee837df6` (agent 4445e935)
2. Merge owner landed #126 as `3ea621fb` (agent 03281126)
3. Rebase owner for #127 in flight (agent 5df97f98); then #128
4. AGY-SCOPE-ORDER RE closed VERIFIED, no Pi change (agent 9e64a695)
5. Fresh owners for remaining anthropic OPEN units after the #127/#128 stack merges
6. Merge owner landed #127 as `2f25719b` after verifier PASS at `44d99927` (agent 1c9b1263)
7. Merge owner landed #128 as `99ae2cea` after verifier PASS at `cdc60a83` (agent d112e851). ANTH-FILE-LOCK closed

Coordinator does not author extension code. Owners write; verifiers read diffs and run package tests.

## Copilot triage follow-ups

| PR | Scope | State |
| --- | --- | --- |
| #133 | XAI-SURFACE-UI ledger close | MERGED `44630f70` |
| #132 | anthropic Copilot follow-up (120/126/127) | MERGED `13386055` |
| #130 | xai grok docs + refresh test scope (Copilot on #119/#121/#122) | MERGED `b07d6f01` |
| #131 | agy import tokeninfo catch (Copilot on #123) | MERGED `ead91e01` |
| #128 | ANTH-FILE-LOCK | MERGED `99ae2cea`. closed |
