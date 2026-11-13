# Grok Build login

`/login` → **Sign in with an account** → **Grok Build (The X Subscription)** asks the user to choose **Browser** or **Device code**. For the browser, Pi shows and opens an authorize URL on `auth.x.ai`. Approving it redirects to a loopback `/callback`, or the user pastes the redirect URL. Either way, the code is exchanged with PKCE at `auth.x.ai/oauth2/token`. For the device code, Pi shows a code and an `accounts.x.ai` link and polls the token endpoint until the user approves. Both store a `grok-build` OAuth credential in `auth.json`.

## Sub-features

- `login-authorize-url`: the opened URL has the same origin, path, nine parameters, and parameter order as `test/fixtures/grok-1.0.70-authorize-url.json`. It also has the same `client_id`, scope (with `%20` separators), `code_challenge_method=S256`, and `referrer=grok-build`. The `redirect_uri` is `http://127.0.0.1:<port>/callback`.
- `login-callback-loopback`: the callback server listens on loopback only. `lsof` shows `127.0.0.1:<port>` (or `[::1]:<port>`), never `*:<port>`.
- `login-browser-callback`: a GET to the loopback callback with the right `state` returns `Signed in`. Pi posts `grant_type, client_id, code, redirect_uri, code_verifier` in that order, where `sha256(code_verifier)` equals the challenge. The pane shows `Logged in to Grok Build (The X Subscription). Credentials saved`.
- `login-browser-paste`: pasting the redirect URL at `Paste the redirect URL` does the same exchange with the pasted code: the same form fields, the same `redirect_uri`, and a `code_verifier` that hashes to the challenge.
- `login-wrong-state`: a pasted URL with another `state` fails with `xAI OAuth callback was rejected`. No token request is made and nothing is stored.
- `login-device-code`: a POST to `/oauth2/device/code` with `client_id, scope, referrer=grok-build` and headers `x-grok-client-version: 1.0.70` and `x-grok-client-surface: ui`. The pane shows `Enter code: <user_code>` and the `accounts.x.ai` link. Polls carry the same headers. One `authorization_pending` reply is followed by success.
- `login-stored`: `auth.json` is mode `0600` and holds `{type:"oauth",access,refresh,expires}`, where `expires` is the exchange time + `expires_in` − 300 s.

## How to get to it (user POV)

- In interactive Pi, type `/login`, then choose **Sign in with an account** and **Grok Build (The X Subscription)**. Then choose **Browser** (the default) or **Device code**.
- With **Browser**, approve in the opened tab. On a remote machine, paste the address bar's redirect URL into Pi.
- `/login` is TUI-only. It has no print or RPC entry point.

## Driving it with control-x-subscription-oauth

Preconditions:

- `doctor` passes, including the `tmux` and `openssl` checks.
- The peer answers `POST auth.x.ai/oauth2/token` with `expires_in: 21600`. It answers `POST auth.x.ai/oauth2/device/code` with `user_code: VRFY-7Q2K`, `verification_uri: https://accounts.x.ai/device`, and `interval: 1`. The first device poll gets `400 {"error":"authorization_pending"}`.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth drive login`. Each case starts a fresh TUI with no `auth.json`.
- **Open the login.** The drive types `/login`, presses Enter twice, filters with `Grok Build (The X Subscription)`, and presses Enter. It waits for `Sign in to Grok Build`.
- **Browser callback.** The drive presses Enter for Browser and waits for `Paste the redirect URL`. It reads the URL from `open.log` and checks it against the fixture. It then GETs `<redirect_uri>?code=verify-callback-code&state=<state>`, the way the browser would. The pane shows `Logged in to Grok Build`. Evidence: `browser-authorize-pane.txt` and `browser-callback-pane.txt`.
- **Wrong state.** The drive starts a new browser login and types `<redirect_uri>?code=verify-wrong-state&state=<random uuid>`, then Enter. The pane shows `xAI OAuth callback was rejected` (`browser-paste-wrong-state-pane.txt`). The drive also checks that no token request was made and nothing was stored.
- **Paste.** The drive starts a new browser login and types the redirect URL with the right state and `code=verify-pasted-code`. The pane shows `Logged in` (`browser-paste-pane.txt`).
- **Device code.** The drive presses Down, then Enter. The pane shows `Enter code: VRFY-7Q2K` and `accounts.x.ai/device` (`device-code-pane.txt`). Within 30 s of the code appearing, it shows `Logged in` (`device-result-pane.txt`).
- **Proof.** `steps.json` records each path, with the authorize URL, the listening address, the token request, the device start and polls, and the stored credential, with its summary, command output, requests, and stored credentials (scrubbed), and `egress.json` holds the refused tunnels and the guard log, which the harness checks after every drive.

## Gotchas

- After a successful login the pane also shows `Error: Logged in to Grok Build (The X Subscription), but no default model is configured for provider "grok-build". Use /model to select a model.` Pi 1.5.2 prints this for any extension provider when no model is selected, because `defaultModelPerProvider` is a built-in table. It is not a login failure. Match the `Logged in to … Credentials saved` line.
- The device flow does not open a browser by itself. Pi shows `(enter to open browser and copy code)`, so `open.log` stays empty in that case.
- The callback server binds `127.0.0.1` on a random port. The drive reads the port from the authorize URL, so never hardcode it. A server on `0.0.0.0` would still put `127.0.0.1` in the redirect URI, so the drive checks the listening address with `lsof`, not the URI.
- Pi's own `/login` dialog races the loopback callback against the paste prompt. If a drive sends a paste after the callback has already won, the paste is ignored.
- A wrong-state GET to the loopback callback, as opposed to a paste, returns HTTP 400 and fails the login the same way. The drive covers only the pasted case.
