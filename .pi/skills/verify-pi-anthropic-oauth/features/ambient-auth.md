# Ambient auth

Without `/login`, a user can export a subscription token (from `claude setup-token`) and run Pi with the `claude-subscription` provider. `ANTHROPIC_AUTH_TOKEN` beats `CLAUDE_CODE_OAUTH_TOKEN`, API keys are rejected, `ANTHROPIC_OAUTH_TOKEN` is ignored, a stored `auth.json` credential beats any ambient token, and ambient tokens are never written to `auth.json`.

## Sub-features

- `ambient-oauth-env` sends `Authorization: Bearer <CLAUDE_CODE_OAUTH_TOKEN>` with no `x-api-key`.
- `ambient-precedence` sends `ANTHROPIC_AUTH_TOKEN` when both variables are set.
- `ambient-api-key-rejected` fails with `CLAUDE_CODE_OAUTH_TOKEN must contain a Claude OAuth access token, not an API key.` and sends no request.
- `ambient-ignored-var` treats `ANTHROPIC_OAUTH_TOKEN` alone as no credential (`No API key found for claude-subscription.`).
- `ambient-none` reports `No API key found for claude-subscription.` and sends no request.
- `ambient-not-persisted` never writes ambient tokens to `auth.json`.
- `stored-wins` uses a stored oauth credential in preference to `CLAUDE_CODE_OAUTH_TOKEN`.

## How to get to it (user POV)

- `CLAUDE_CODE_OAUTH_TOKEN=… pi --provider claude-subscription --model claude-sonnet-4-6 -p "…"`.
- The same variables apply in interactive and RPC sessions. Only print mode is driven.

## Driving it with control-claude-oauth

Preconditions:

- `doctor` passes. Ambient variables in your shell don't matter, because the harness removes them.

- **Run.** `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth drive ambient-auth`. The drive runs six print-mode cases against one local peer and prints a summary line for each.
- **Succeeding cases.** `CLAUDE_CODE_OAUTH_TOKEN`, both variables set, and stored plus ambient: each exits `0` with stdout `LOCAL_OK`, sends exactly one request, and the bearer is the expected token.
- **Failing cases.** API key, `ANTHROPIC_OAUTH_TOKEN` only, and nothing set: each exits non-zero with the expected message and sends zero requests.
- **Proof.** `artifacts/verify-pi-anthropic-oauth/ambient-auth/cases.json` records each case's environment (masked), command, exit code, stdout, stderr, recorded request headers, and the stored credential, if any. `auth.json` stays `{}` until the stored-wins case writes it.

## Gotchas

- The rejection message comes from Pi wrapped as `API key auth check failed for provider claude-subscription: …`. Match the inner sentence.
- `pi -p` with no `--provider` and no saved default fails before auth is consulted. Always pass `--provider` and `--model`.
- A synthetic token must start with `sk-ant-oat01-`, or the extension rejects it as an API key.
- The local peer accepts any bearer. This drive proves which token Pi sends, not that Anthropic would accept it.
