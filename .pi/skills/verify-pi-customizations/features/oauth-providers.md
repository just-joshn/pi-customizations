# OAuth providers

OAuth extensions register Claude (`claude-subscription` via `pi-anthropic-oauth`), Antigravity (`google-antigravity` via `pi-antigravity-oauth`), Grok Build (`grok-build` via `pi-x-subscription-oauth`), and Cursor (`cursor` via `pi-x-subscription-oauth`) providers when they load. Antigravity also registers `/antigravity`, and the X subscription extension registers `/usage` for Grok Build. Pi lists models when native auth resolution reports the provider configured. Claude supports stored credentials and ambient subscription tokens. The harness below checks fixture-backed CLI model visibility.

## Sub-features

- `claude-provider` exposes Claude subscription models in Pi model pickers and `--list-models` output.
- `antigravity-provider` exposes Google Antigravity subscription models in Pi model pickers and `--list-models` output.
- `grok-build-provider` exposes Grok Build subscription models in Pi model pickers and `--list-models` output.
- `cursor-provider` exposes Cursor models in Pi model pickers and `--list-models` output.
- `grok-usage` reports Grok Build plan usage through `/usage`; logged out it reports `Grok Build is not logged in. Run /login and choose Grok Build.`
- `antigravity-account` reports the Google Antigravity account, project, tier, and quota through `/antigravity`. Logged out, it reports `Google Antigravity is not logged in. Run /login and choose Google Antigravity.` as an error notification.
- `auth-discovery` uses Pi's native credential resolution. When no stored credential owns the provider, Claude accepts a subscription token from `ANTHROPIC_AUTH_TOKEN`, then `CLAUDE_CODE_OAUTH_TOKEN`. The value must be a `sk-ant-oat01-` OAuth access token; an API key is rejected. The Antigravity provider reads `projectId` from its credential record.

## How to get to it (user POV)

- Run `pi --list-models claude-subscription` with `pi-anthropic-oauth` loaded and a matching OAuth credential record in the `auth.json` for your normal Pi data directory.
- Run `pi --list-models google-antigravity` with `pi-antigravity-oauth` loaded and a matching OAuth credential record in the `auth.json` for your normal Pi data directory.
- Run `pi --list-models grok-build` with `pi-x-subscription-oauth` loaded and a matching OAuth credential record in the `auth.json` for your normal Pi data directory.
- Run `pi --list-models cursor` with `pi-x-subscription-oauth` loaded and a Cursor OAuth credential.
- Run `/usage` with `pi-x-subscription-oauth` loaded to view Grok Build plan usage.
- Select provider models in Pi interactive model picker (`/model`).
- Run `/antigravity` in Pi interactive chat or over RPC with `pi-antigravity-oauth` loaded.
- Run `/login` and choose Claude subscription, Google Antigravity, Grok Build, or Cursor. This drive does not cover login.

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- For the manual `pi --list-models` commands below, the `auth.json` in your normal Pi data directory must contain a matching OAuth credential record. The driver creates a separate temporary `auth.json` fixture for its own checks.

- **List Claude models manually.** Execute `pi --no-extensions -e extensions/pi-anthropic-oauth --list-models claude-subscription`. The model list includes Claude Opus and Sonnet models from the installed Pi Anthropic catalog. Exact model IDs depend on the Pi version.
- **List Antigravity models manually.** Execute `pi --no-extensions -e extensions/pi-antigravity-oauth --list-models google-antigravity`. The model list includes `gemini-3.8-flash`, `claude-opus-5-5`, and other Antigravity catalog models.
- **List Grok Build models manually.** Execute `pi --no-extensions -e extensions/pi-x-subscription-oauth --list-models grok-build`. The model list includes `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`, and the reasoning tier aliases `grok-4.7-low-fast`, `grok-4.7-medium-fast`, `grok-4.7-high-fast`, and `grok-4.7-xhigh-fast`.
- **Run verification.** Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive oauth-providers`. The driver checks all four fixture-backed listings, then uses separate logged-out RPC sessions to assert `/antigravity` and `/usage` registration and their not-logged-in error notifications.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/oauth-providers/claude-models.txt`, `antigravity-models.txt`, `grok-build-models.txt`, `cursor-models.txt`, `antigravity-command.json`, and `usage-command.json`. The fixture drive proves representative model listings and the logged-out reports only. It does not prove login, token validity, token refresh, or a successful model response.

## Gotchas

- Providers register when their extensions load, whether or not credentials exist. Stored OAuth fixtures configure all providers in this drive. Claude can also resolve an ambient subscription token. Listing does not prove that a token is valid.
- Provider keys are `claude-subscription`, `google-antigravity`, `grok-build`, and `cursor`. The Cursor fixture checks the baseline `composer-2.5` model; it does not access Keychain or run Cursor login.
- Pi core reads `auth.json`; the Antigravity provider reads `projectId` from its credential record.
- The harness creates its own disposable scratch directory, removes ambient credential variables from provider subprocesses, and supplies synthetic, unexpired OAuth records for CLI listing. These are not active subscription credentials, and no manual initialization is needed.
- The harness writes fixture `auth.json` with mode `0600` as secure setup, not as a test of permission rejection. Pi's read path does not require that file mode.
- This drive does not verify `/model`, OAuth login, live token refresh, authenticated catalog discovery, or live inference. Those routes require real credentials and, for Antigravity, project entitlement.
- Claude's separate `extensions/pi-anthropic-oauth/scripts/prove-native.ts` probe exercises print, JSON, RPC, ambient auth, fork, reload, session replacement, tool execution, and cancellation against a local Messages server. `scripts/prove-request-paths.ts` covers compaction and virtual routing, and `scripts/prove-context-guard.ts` covers the context guard. `bun run prove` runs all three. All three use synthetic tokens and leave live subscription acceptance unverified.
