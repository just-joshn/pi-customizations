# Login

A user signs in to Google Antigravity from Pi's `/login` dialog. On macOS, the extension asks for a method: **Sign in with Google in the browser**, or **Import from the Antigravity CLI keychain**. On other platforms it goes straight to the browser flow. Either way, it then finds the account's Cloud Code project and writes Pi's `auth.json`.

## Sub-features

- `login-menu`: **Google Antigravity** appears under "Sign in with an account". On macOS the next screen is `How do you want to sign in to Google Antigravity?`, with both methods.
- `login-keychain`: runs `security find-generic-password -s gemini -a antigravity -w` and decodes the `go-keyring-base64:` JSON. It then calls `loadCodeAssist` with `{"metadata":{"ideType":"ANTIGRAVITY"}}` and stores `{type:"oauth",access,refresh,expires:expiry-10s,projectId,email}` with file mode `0600`. It never contacts Google.
- `login-onboard`: when `loadCodeAssist` names no project, the flow calls `onboardUser` with `{"tierId":"free-tier","metadata":{"ideType":"ANTIGRAVITY"}}`, then calls `loadCodeAssist` again.
- `login-browser-url`: opens and shows `https://accounts.google.com/o/oauth2/auth` with the agy client id, `redirect_uri=https://antigravity.google/oauth-callback`, `access_type=offline`, `prompt=consent`, S256 PKCE, `state`, and the cloud-platform/cclog/experimentsandconfigs/aicode/openid scopes.
- `login-browser-paste`: sends the pasted code only to `oauth2.googleapis.com`. If the exchange fails, nothing is stored and Cloud Code is never called.

## How to get to it (user POV)

- In interactive Pi, type `/login`, choose **Sign in with an account**, filter to **Google Antigravity**, and pick a method (macOS only).
- `/login google-antigravity` opens the provider directly. Not driven.

## Driving it with control-antigravity-oauth

Preconditions:

- `doctor` passes, including the `tmux` check.
- No manual setup is needed. The drive writes the synthetic keychain password file and points `CLOUD_CODE_URL` at its peer.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth drive login`. It prints `"status": "PASS"`.
- **Open the method menu.** The drive types `/login` and presses Enter, then presses Enter on "Sign in with an account". It types `Antigravity` and presses Enter on `→ Google Antigravity`. The pane shows both methods (`keychain-import-methods.txt`).
- **Keychain import.** The drive sends `Down Enter`. The pane shows `Logged in to Google Antigravity. Credentials saved to …/agent/auth.json` (`keychain-import-result.txt`). In `login.json` → `keychain-import`:
  - `securityArgv` is exactly `find-generic-password -s gemini -a antigravity -w`.
  - `auth.json` is mode `600` and holds the synthetic tokens, `projectId: verify-project-keychain`, and the email.
  - The peer saw one `loadCodeAssist`, carrying the agy user agent and the bearer token.
  - `egress` is empty.
- **Keychain import with onboarding.** The drive restarts Pi with an empty `auth.json`. The peer's first `loadCodeAssist` names no project. The peer sees `loadCodeAssist → onboardUser → loadCodeAssist`, and the stored `projectId` is `verify-project-onboarded` (`login.json` → `keychain-onboard`).
- **Browser.** The drive restarts Pi with an empty `auth.json` and presses Enter on **Sign in with Google in the browser**. The pane shows the authorize URL and `Paste the authorization code here:` (`browser-authorize.txt`). The `open` stub receives exactly one URL, whose parameters match `login-browser-url` (`login.json` → `browser.authorizeUrl`, with state and challenge masked).
- **Paste.** The drive types `verify-code-not-real` and presses Enter. The pane shows `Error: Failed to login to Google Antigravity: fetch failed` (`browser-paste-result.txt`). In evidence:
  - The egress log is exactly `["oauth2.googleapis.com:443"]`.
  - The peer saw zero requests.
  - `auth.json` has no `google-antigravity` entry.

## Gotchas

- After a successful import, Pi 1.5.2 also shows `Error: Logged in to Google Antigravity, but no default model is configured for provider "google-antigravity". Use /model to select a model.` The credential is still saved. Pi's `defaultModelPerProvider` table is built in, and an extension cannot add to it, so the drive does not count this message as a failure.
- Without the `security` stub on `PATH`, keychain import on a Mac reads the real `gemini/antigravity` item. If `agy` is signed in, that item holds a real Google token.
- Without the egress sink, the paste step sends the code, the agy client secret, and the PKCE verifier to Google. That fails harmlessly with a fake code, but it is real network traffic. A real code would complete a live login.
- Keychain import treats an `invalid_token`/`invalid_grant` failure from Cloud Code as a reason to call Google's `tokeninfo`. The drive's peer never returns those errors, so this path is covered only by `keychain.test.ts`.
- Pi's login dialog spawns the browser opener detached, so the `open.log` entry can land after the pane renders. Poll the file instead of reading it once.
- These drives run Pi with `--offline`, so the provider catalog refresh after login stays offline. The model-catalog drive covers the networked refresh.
