# Sign in and out

A Google AI subscriber connects their account to Pi, sees their plan/project, can cancel sign-in without saving a partial credential, and can remove the saved login.

## Sub-features

- `login-picker`: choose **Google AI subscription** from `/login`.
- `login-direct`: open that provider using `/login google-oauth-v2`.
- `login-browser`: complete the browser callback and see plan/project confirmation.
- `login-code`: use **Code page** and paste its authorization code instead.
- `login-cancel`: cancel an unfinished login without leaving auth or a listening callback.
- `logout`: remove the isolated profile's Google login through `/logout`.

## How to get to it (user POV)

- Start Pi, run `/login`, and search/select **Google AI subscription**.
- Alternatively run `/login google-oauth-v2` directly.
- Choose the displayed browser link or **Code page** fallback, then follow Google sign-in.
- Run `/logout` and choose the same provider to disconnect.

## Driving it with native Pi/tmux

Preconditions:

- Fresh empty profile; start `python3 "$HELPER" serve-tui "$EVIDENCE"` through `tmux_run` **without** `--offline`. No copied credentials.
- The owner can participate in Google consent; no concurrent browser sign-in. Capture only redacted login evidence.

- **Picker.** Send `printf '/login\r' > "$INPUT"` (the PTY FIFO from the skill); capture the provider picker. Search `Google AI subscription`, verify the highlighted label, then Enter. The page asks to sign in with the Google account having the AI plan and displays an **Authorization code** prompt / **Code page** link. Record labels, not URLs/codes.
- **Cancel.** On an empty profile, press Escape and wait for the normal editor. Run `python3 "$HELPER" doctor "$EVIDENCE"`; require `oauthPresent: false`. Record this run's loopback listener from process-owned sockets before cancel and verify it is gone afterward (`lsof -nP -a -p PID -iTCP -sTCP:LISTEN`, using the actual owned Pi child PID from `ps`). Never probe a guessed port or another session.
- **Direct path.** Send `printf '/login google-oauth-v2\r' > "$INPUT"`. Require the same Google authorization surface; this separately covers the direct entry point.
- **Browser.** Have the owner complete the displayed login in the browser. Wait for `Google AI plan:` and `Code Assist project:` information and return to the editor. Redact plan/project account details as appropriate. Doctor must now show `oauthPresent`, `oauthUnexpired`, and `projectPresent` true. Verify a real request via the requests map to establish usable auth; local booleans alone cannot prove server acceptance.
- **Code page.** In a separate fresh run, repeat direct login, have the owner open **Code page** on their browser-equipped machine, and privately paste its code in **Authorization code**, then Enter. Require the same successful outcomes. Do not log the code or automate the owner's password/MFA.
- **Logout.** Send `/logout`, search/select **Google AI subscription**, Enter. Doctor must report `oauthPresent: false`; re-open `/login` to confirm the provider remains offered, then cancel. The normal profile must remain unchanged at cleanup.

## Gotchas

- OAuth URLs, callback query strings and pasted codes are sensitive; blanket `capture-pane` during login can leak them.
- `copy-auth` is useful for other journeys but invalidates a login claim. Test picker and direct paths, browser and Code page independently.
- No account/consent means login is NOT VERIFIED with that explicit reason. No mocked success, fabricated token or pre-seeded login can satisfy this map.
- If Google requires a project, set the real project ID (not number) via `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` before launch and retry login. Account validation and unsupported-client messages need owner/provider action, not harness workarounds.
- The loopback listener times out after five minutes; Code page can still finish afterward. Cancellation evidence needs observed listener closure, not just disappearance of the prompt.
