# Cursor login

`/login` → **Sign in with an account** → **Cursor (The X Subscription)** opens no dialog. It tries three ways to get a usable Cursor session, in order. First, it copies a live session from the macOS keychain. Second, it exchanges the keychain's `cursor-api-key` for a new access token at `api2.cursor.sh/auth/exchange_user_api_key`. Third, it runs `cursor-agent login` and reads the keychain again. The result is stored as a `cursor` OAuth credential whose expiry comes from the JWT `exp` claim. The API key is never stored.

## Sub-features

- `cursor-login-keychain`: `security find-generic-password -s cursor-access-token -a cursor-user -w`, then the same for `cursor-refresh-token`. The stored credential is `{access, refresh, expires: exp*1000}`. Pi makes no network request and does not run `cursor-agent`.
- `cursor-login-exchange`: with no session, Pi sends `POST https://api2.cursor.sh/auth/exchange_user_api_key` with `Authorization: Bearer <cursor-api-key>` and body `{}`. Cursor answers `{accessToken}`. Pi stores `{access: accessToken, refresh: "cursor-keychain", expires}`, and `auth.json` does not contain the API key. The keychain lookups are exactly `cursor-access-token` (missing), then `cursor-api-key`.
- `cursor-login-agent`: with nothing in the keychain, Pi runs `cursor-agent login` (argv exactly `["login"]`). The keychain lookups are exactly `cursor-access-token` (missing), `cursor-api-key` (missing), then `cursor-access-token` and `cursor-refresh-token` again after the CLI login.
- `cursor-login-stored`: the pane shows `Logged in to Cursor (The X Subscription). Credentials saved`, and `auth.json` is mode `0600`.

## How to get to it (user POV)

- Sign in with `cursor-agent login` first, or keep an existing Cursor keychain session. Then, in interactive Pi, type `/login`, choose **Sign in with an account**, and choose **Cursor (The X Subscription)**.
- `/login` is TUI-only.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes and reports that `security` and `cursor-agent` resolve to the stubs.
- The keychain is a set of files in `keychain/<service>` inside the scratch run, and the drive resets it before each case.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive cursor-login`.
- **Open the login.** The drive types `/login`, presses Enter twice, filters with `Cursor (The X Subscription)`, and presses Enter. Login runs at once.
- **Keychain.** The drive seeds `cursor-access-token` and `cursor-refresh-token` with the same one-hour JWT. The pane shows `Logged in to Cursor` (`keychain-pane.txt`). The drive asserts the two `security` lookups, zero peer requests, and zero `cursor-agent` calls.
- **API-key exchange.** The drive seeds only `cursor-api-key`. The pane shows `Logged in` (`api-key-exchange-pane.txt`). The peer saw the exchange with the key as the bearer token, the stored access token is the minted one, and the `security` lookups match `cursor-login-exchange` exactly.
- **cursor-agent login.** The drive empties the keychain. The `cursor-agent` stub's `login` copies a new JWT into `keychain/cursor-access-token`. The pane shows `Logged in` (`cursor-agent-login-pane.txt`). `cursor-agent.log` is `["login"]`, and the `security` lookups match `cursor-login-agent` exactly.
- **Proof.** `steps.json` records each case's `security` argv, exchange request, `cursor-agent` argv, and stored credential with its summary, command output, requests, and stored credentials (scrubbed), and `egress.json` holds the refused tunnels and the guard log, which the harness checks after every drive.

## Gotchas

- Never run this flow without the stubs. On a Mac with Cursor signed in, the real `security` returns your real JWT and the real `cursor-agent login` opens a browser.
- A keychain session that expires within 5 minutes counts as not usable, and Pi moves on to the exchange. A JWT with no `exp` claim is treated as expiring in 2100.
- If the exchange fails for any reason other than a cancel, `/login` falls through to `cursor-agent login` without showing an error. To prove that the exchange path was taken, look at the peer request, not the pane.
- `cursor-agent login` runs with `stdio: 'inherit'`, so a real CLI's output would draw over the TUI. The stub prints one line.
- The pane also shows `no default model is configured for provider "cursor"`. As with Grok Build login, this is Pi behavior and not a failure.
