# OAuth providers

OAuth extensions register Claude (`claude-subscription` via `pi-anthropic-oauth`) and Antigravity (`google-antigravity` via `pi-antigravity-oauth`) providers when they load. Pi lists a provider's models only when `auth.json` contains a matching OAuth credential record.

## Sub-features

- `claude-provider` exposes Claude subscription models in Pi model pickers and `--list-models` output.
- `antigravity-provider` exposes Google Antigravity subscription models in Pi model pickers and `--list-models` output.
- `auth-discovery` uses credentials from Pi's `auth.json`. The Antigravity provider reads `projectId` from its credential record.

## How to get to it (user POV)

- Run `pi --list-models claude-subscription` with `pi-anthropic-oauth` loaded and a matching OAuth credential record in the `auth.json` for your normal Pi data directory.
- Run `pi --list-models google-antigravity` with `pi-antigravity-oauth` loaded and a matching OAuth credential record in the `auth.json` for your normal Pi data directory.
- Select provider models in Pi interactive model picker (`/model`).

## Driving it with control-pi

Preconditions:

- Environment passes `./.pi/skills/verify-pi-customizations/bin/control-pi doctor`.
- For the two manual `pi --list-models` commands below, the `auth.json` in your normal Pi data directory must contain a matching OAuth credential record. The driver creates a separate temporary `auth.json` fixture for its own checks.

- **List Claude models manually.** Execute `pi --no-extensions -e extensions/pi-anthropic-oauth --list-models claude-subscription`. The model list includes `claude-opus-5-5`, `claude-sonnet-4-6`, and other subscription models.
- **List Antigravity models manually.** Execute `pi --no-extensions -e extensions/pi-antigravity-oauth --list-models google-antigravity`. The model list includes `gemini-3-flash-agent`, `claude-opus-4-6-thinking`, and other Antigravity models.
- **Run verification.** Run `./.pi/skills/verify-pi-customizations/bin/control-pi drive oauth-providers`.
- **Proof.** Verify that artifacts exist at `artifacts/verify-pi-customizations/oauth-providers/claude-models.txt` and `antigravity-models.txt`. The fixture drive proves model listing only. It does not prove login, token validity, token refresh, or a successful model response.

## Gotchas

- Providers register when their extensions load, whether or not credentials exist. Pi lists their models only when `auth.json` has a matching OAuth credential record. Listing does not prove that the token is valid.
- Provider keys are `claude-subscription` and `google-antigravity`.
- Pi core reads `auth.json`; the Antigravity provider reads `projectId` from its credential record.
- `control-pi` creates its own scratch directory and writes fixture `auth.json` with mode `0600`. Pi's read path does not require that file mode.
