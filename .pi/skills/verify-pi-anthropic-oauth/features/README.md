# pi-anthropic-oauth verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-anthropic-oauth` extension, the `claude-subscription` provider. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `bun install --frozen-lockfile` at the repo root once.
- `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth doctor` passes.
- Drives use the installed `pi` on `PATH` (proven on 1.5.2) and load the extension from the working tree with `-e extensions/pi-anthropic-oauth`.
- The harness creates the scratch agent directory, Claude config directory, local Messages peer, and synthetic tokens itself. Do not pre-seed anything, and never drive `~/.pi/agent`.

## Driving conventions

- Use `control-claude-oauth drive <feature>` for every mapped drive. Manual steps in a feature file must use a scratch `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR`.
- Send TUI input through the run's private tmux socket only. Type literal text with `send-keys -l`, and match on pane text, not screen coordinates.
- Model `claude-subscription/claude-sonnet-4-6`, thinking `off`, prompt `Reply LOCAL_OK.` (from the 2.1.316 capture fixture).

## Proof and skip reporting

- Evidence is written to `artifacts/verify-pi-anthropic-oauth/<feature>/`. `run.json` there holds the status, Pi version, and first failed assertion.
- Proof for auth includes both the request the peer saw (or the absence of one) and the resulting `auth.json`.
- Proof for TUI flows includes pane captures for each step and the stored or unchanged files.
- Report which entry point you drove. Login has three methods, and passing one does not verify the others.

## Not drivable locally (report as unverified)

- **Token refresh and 401 recovery.** The token endpoint is hard-coded to `https://platform.claude.com/v1/oauth/token`, and `CLAUDE_CODE_CUSTOM_OAUTH_URL` accepts only Anthropic staging hosts, so no local peer can answer a refresh. Use the package's vitest suites (`auth-401-refresh`, `refresh-*`) and the `verify-oauth-refresh-lock` skill instead, and say so in the report.
- **Successful paste-code or browser-callback exchange** and **live subscription acceptance.** These need a real Anthropic account. `bun run live:exchange` is gated by `parity/oauth-rea-2026-10-31/claude/gates.md`.
- **`/logout` and token revocation.** No drive covers them yet.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-claude-oauth` starts with `Preconditions:` and pairs each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Login](./login.md) covers `/login` → Claude subscription: Import from Claude Code and Paste code (authorize URL and wrong-sign-in rejection). Browser callback is not driven.
- [Ambient auth](./ambient-auth.md) covers `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` precedence, API-key rejection, an ignored `ANTHROPIC_OAUTH_TOKEN`, and the stored credential winning.
- [Request identity](./request-identity.md) covers the Claude Code user agent, beta flags, billing fingerprint, session and prompt headers, and the `models.json` header override.
- [Tool calls](./tool-calls.md) covers Claude-cased tool declarations and Read and Bash tool round-trips.
- [Context guard](./context-guard.md) covers keeping subscription requests under the model window after a switch from a cheaper-tokenizer provider.
