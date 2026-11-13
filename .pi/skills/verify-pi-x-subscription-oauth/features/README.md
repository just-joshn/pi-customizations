# pi-x-subscription-oauth verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-x-subscription-oauth` extension. The extension provides the `grok-build` provider, the `cursor` provider, and the `/usage` command. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `bun install --frozen-lockfile` at the repo root once.
- `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth doctor` passes.
- Drives use the installed `pi` on `PATH`, proven on 1.5.2 on macOS arm64. They load the extension from the working tree with `-e extensions/pi-x-subscription-oauth`.
- The harness creates everything a drive needs: the scratch agent dir, the scratch CA, the proxy and peers, the stubs, and the synthetic tokens. Do not pre-seed anything, and never drive `~/.pi/agent`.

## Driving conventions

- Use `control-x-subscription-oauth drive <feature>` for every mapped drive. The proxy and peers live only inside the drive process, so a kept run's `tui.sh` cannot be relaunched by hand. To check something new, add a step to the drive.
- Send TUI input only through the run's private tmux socket. Type literal text with `send-keys -l`, and match on pane text, not screen coordinates.
- Peer routes are keyed `METHOD host/path`, such as `POST auth.x.ai/oauth2/token`. A request with no route gets 404 and still appears in the evidence.
- Stored credential shapes:
  - `grok-build`: `{type:"oauth",access,refresh,expires}`
  - `cursor`: `{type:"oauth",access:<JWT>,refresh:<JWT or "cursor-keychain">,expires:<exp*1000>}`
- The prompt is `Reply LOCAL_OK.`.

## Proof and skip reporting

- Evidence goes to `artifacts/verify-pi-x-subscription-oauth/<feature>/`. `run.json` there holds the status, Pi version, platform, and first failed assertion.
- A proof includes `steps.json` (each step's requests, outputs, and, for logins, the resulting credential) and `egress.json` (no refused tunnel, and a guard log that matches the drive's declared `egress` exactly; the harness checks both after every drive).
- Report which entry point you drove. Grok Build login has three: the browser callback, the pasted redirect URL, and the device code. Cursor login has three: the keychain, the API-key exchange, and `cursor-agent login`. `/usage` has a print path and a TUI path. A Cursor ask has the native path and the fallback. Passing one entry point does not verify the others.
- Cursor keychain reads go through the macOS `security` CLI. The stub stands in for it on every OS, so the cursor drives also pass on Linux. Real keychain behavior is proven only on a Mac with a real Cursor login.

## Not drivable locally (report as unverified)

- **Real acceptance by xAI or Cursor.** Real acceptance covers the subscription scope grant, a real model reply, real billing numbers, and Cursor's real protobuf schema. The peers implement the shapes captured in `test/fixtures/` and nothing else. `make verify-x-subscription-oauth-live`, run while logged in, sends one live Grok Build prompt.
- **Token refresh.** Grok Build refresh belongs to Pi's built-in `xai` OAuth path, and Cursor refresh posts `cursor-api-key` to `/auth/exchange_user_api_key`. A refresh runs only when a stored credential is within 5 minutes of expiry, and every drive stores a far-future or one-hour expiry, so no drive triggers one. The same exchange also runs during `/login` when the keychain has no session. The cursor-login drive covers that login path, not refresh. Use the vitest suites (`pi-owned-auth.test.ts`, `cursor.test.ts`) for this and say so in the report.
- **The `cursor-agent` missing-binary error.** A real `cursor-agent` may sit on `PATH` behind the stub, so the drive never removes the stub. `cursor.test.ts` covers the `CURSOR_BIN_HINT` text.
- **`/logout`** has no drive.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. Four H2 sections follow, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with control-x-subscription-oauth`: starts with `Preconditions:`, then pairs each user action with the exact command and the observable result.
4. `Gotchas`: traps that can waste a verification run or invalidate it.

## Features

- [Grok Build login](./login.md): `/login` → Grok Build. Covers the authorize URL against the Grok 1.0.70 capture, the loopback callback with PKCE, the pasted redirect URL, wrong-state rejection, and the device code with a pending poll.
- [Cursor login](./cursor-login.md): `/login` → Cursor. Covers keychain session import, the `cursor-api-key` exchange, and the `cursor-agent login` fallback.
- [Grok Build chat](./chat.md): request headers, effort aliases, `models.json` header and context overrides, the 402 balance message, and `x-grok-conv-id` as the session id.
- [Model catalog](./model-catalog.md): the offline baseline (8 grok-build ids, `cursor/composer-2.5`), the `/model` refresh of both catalogs, and the saved list reused offline.
- [Usage](./usage.md): `/usage` when logged out, the weekly meter with the product split, and the 401 message, in print mode and in the TUI.
- [Cursor ask](./cursor-ask.md): the native HTTP/2 `Run` with the context reply and usage, Cursor's refusal text, `ERROR_NOT_LOGGED_IN`, and the `cursor-agent` fallback argv.
