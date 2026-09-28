# OAuth providers

OAuth extensions register subscription model providers for Claude (`claude-subscription` via `pi-anthropic-oauth`) and Antigravity (`google-antigravity` via `pi-antigravity-oauth`) when credentials are present.

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

- **List Claude models.** Execute `pi --no-extensions -e extensions/pi-anthropic-oauth --list-models claude-subscription`. The model list includes `claude-opus-5-5`, `claude-sonnet-4-6`, and other subscription models.
- **List Antigravity models.** Execute `pi --no-extensions -e extensions/pi-antigravity-oauth --list-models google-antigravity`. The model list includes `gemini-3-flash-agent`, `claude-opus-4-6-thinking`, and other Antigravity models.
- **Run verification.** Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive oauth-providers`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/oauth-providers/claude-models.txt` and `antigravity-models.txt`.

## Gotchas

- Models only register if `auth.json` exists in `PI_CODING_AGENT_DIR` with an active credential matching the provider key.
- Provider keys are `claude-subscription` and `google-antigravity`.
- `auth.json` must have strict filesystem permissions (`0600`) to be loaded securely.
