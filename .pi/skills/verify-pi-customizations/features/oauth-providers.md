# OAuth providers

OAuth extensions register subscription model providers for Claude (`claude-subscription` via `pi-anthropic-oauth`) and Antigravity (`google-antigravity` via `pi-antigravity-oauth`) when the extensions load. Credentials govern authenticated use; the harness checks fixture-backed CLI model visibility.

## Sub-features

- `claude-provider` exposes Claude subscription models in Pi model pickers and CLI flags.
- `antigravity-provider` exposes Google Antigravity subscription models in Pi model pickers and CLI flags.
- `auth-discovery` reads OAuth tokens and project IDs from `auth.json`.

## How to get to it (user POV)

- Run `pi --list-models claude-subscription` with `pi-anthropic-oauth` loaded.
- Run `pi --list-models google-antigravity` with `pi-antigravity-oauth` loaded.
- Select provider models in Pi interactive model picker (`/model`).

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- Disposable `PI_CODING_AGENT_DIR` scratch directory initialized with fixture credentials in `auth.json` (mode `0600`).

- **List Claude models.** Execute `pi --no-extensions -e extensions/pi-anthropic-oauth --list-models claude-subscription`. The model list includes Claude Opus models from the installed Pi Anthropic catalog; exact model IDs depend on the Pi version.
- **List Antigravity models.** Execute `pi --no-extensions -e extensions/pi-antigravity-oauth --list-models google-antigravity`. The model list includes `gemini-3-flash-agent`, `claude-opus-4-6-thinking`, and other Antigravity models.
- **Run verification.** Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive oauth-providers`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/oauth-providers/claude-models.txt` and `antigravity-models.txt`.

## Gotchas

- Both extensions register providers without checking credentials. The harness supplies synthetic, unexpired OAuth records for CLI listing; these are not active subscription credentials.
- Provider keys are `claude-subscription` and `google-antigravity`.
- The harness writes fixture `auth.json` with mode `0600` as secure setup, not as a test of permission rejection.
- The harness creates its own disposable scratch directory and fixture credentials; no manual initialization is needed.
- This drive does not verify `/model`, OAuth login/refresh, authenticated catalog discovery, or inference. Those routes require real credentials and, for Antigravity, project entitlement; they were not attempted by this recipe.
