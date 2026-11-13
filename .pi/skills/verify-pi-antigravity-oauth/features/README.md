# pi-antigravity-oauth verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-antigravity-oauth` extension, the `google-antigravity` provider. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `bun install --frozen-lockfile` at the repo root once.
- `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth doctor` passes.
- Drives use the installed `pi` on `PATH` (proven on 1.5.2, macOS arm64) and load the extension from the working tree with `-e extensions/pi-antigravity-oauth`.
- The harness creates the scratch agent dir, the Cloud Code peer, the egress sink, the `security`/`open` stubs, and the synthetic tokens. Do not pre-seed anything, and never drive `~/.pi/agent`.

## Driving conventions

- Use `control-antigravity-oauth drive <feature>` for every mapped drive. Manual steps must use a scratch `PI_CODING_AGENT_DIR`, a local `CLOUD_CODE_URL`, and the `security` stub.
- Send TUI input only through the run's private tmux socket. Type literal text with `send-keys -l`, and match on pane text, not screen coordinates.
- The stored credential shape is `{type:"oauth",access,refresh,expires,projectId,email}`. The prompt is `Reply LOCAL_OK.`.

## Proof and skip reporting

- Evidence goes to `artifacts/verify-pi-antigravity-oauth/<feature>/`. `run.json` there holds the status, Pi version, platform, and first failed assertion.
- A proof includes the requests the Cloud Code peer saw (or the absence of any), the egress log, and, for login, the resulting `auth.json`.
- Report which entry point you drove. Login has a keychain path and a browser path, and `/antigravity` has a print path and a TUI path. Passing one does not verify the other.
- On a non-macOS host, the login drive records the keychain cases as "not offered", because `keychainImportAvailable()` is darwin-only. Report them as unverified on that host. They are not a pass.

## Not drivable locally (report as unverified)

- **A successful browser code exchange and token refresh.** The token, userinfo, and tokeninfo endpoints are hard-coded to Google (`GOOGLE_OAUTH` in `src/oauth.ts`), and the egress sink refuses them. For these paths, use the package's vitest suites (`oauth.test.ts`, `keychain.test.ts`) and say so in the report.
- **The `/antigravity` email line.** userinfo is a Google host, so the drive always shows `Account: unknown`.
- **Live acceptance by Cloud Code** (real models, quota, onboarding). This needs a real account. `node --experimental-strip-types extensions/pi-antigravity-oauth/scripts/prove-pi.ts` sends one live prompt if you are logged in.
- **`/logout`**: no drive covers it.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. Four H2 sections follow, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with control-antigravity-oauth`: starts with `Preconditions:`, then pairs each user action with the exact command and the observable result.
4. `Gotchas`: traps that can waste a verification run or invalidate it.

## Features

- [Login](./login.md): `/login` → Google Antigravity. Covers keychain import (direct project, and onboarding through `onboardUser`) and the browser authorize URL, with the pasted code refused at the token host.
- [Chat](./chat.md): the Cloud Code envelope, the `agy` user agent, the request id, how a thinking level picks the Cloud Code model id, and the no-credential error.
- [Tool calls](./tool-calls.md): OpenAPI tool declarations with upper-case types, the `read` and `bash` round-trips, and the tool-result turn role (`model` for Gemini, `user` for other models).
- [Model catalog](./model-catalog.md): the offline snapshot listing, and the `/model` selector replacing it with the account's `fetchAvailableModels` catalog.
- [Account command](./account-command.md): `/antigravity` when logged out, the project/tier/quota summary, and the quota-error line, in print mode and in the TUI.
