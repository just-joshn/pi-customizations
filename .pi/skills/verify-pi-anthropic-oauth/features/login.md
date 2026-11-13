# Login

A user signs in to their Claude subscription from Pi's `/login` dialog. The extension offers three methods: **Paste code** (the default), **Browser callback**, and **Import from Claude Code**. A successful login writes only Pi's `auth.json`. Claude Code's own credential files are never written.

## Sub-features

- `login-menu` lists **Claude subscription** under "Sign in with an account" and shows the three methods under "Sign in to Claude subscription".
- `login-import` copies `claudeAiOauth` from the Keychain item `Claude Code-credentials` (macOS) or from `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json` into `auth.json` as `{type:"oauth",access,refresh,expires}`, leaving the source unchanged.
- `login-paste-url` opens and shows `https://claude.com/cai/oauth/authorize?code=true&client_id=…&response_type=code&redirect_uri=https://platform.claude.com/oauth/code/callback&scope=…user:plugins&code_challenge=…&code_challenge_method=S256&state=…`.
- `login-paste-wrong-state` rejects a pasted `code#state` from another sign-in with `That code is not from this sign-in. Paste the code shown after opening the address above.` and stores nothing.
- `login-loopback` binds `http://localhost:<port>/callback` for the browser redirect. Not driven.

## How to get to it (user POV)

- In interactive Pi, type `/login`, choose **Sign in with an account**, filter to **Claude subscription**, and choose a method.
- `/login claude-subscription` jumps straight to the provider. Not driven.

## Driving it with control-claude-oauth

Preconditions:

- `doctor` passes, including `tmux`.
- No manual setup. The drive writes a synthetic `claude/.credentials.json` into the scratch `CLAUDE_CONFIG_DIR`.

- **Run.** `./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth drive login`. The drive prints `"status": "PASS"`.
- **Open the provider list.** The drive types `/login`, presses Enter, and waits for `Select authentication method`. It presses Enter on "Sign in with an account", waits for `Select provider to configure`, types `Claude subscription`, and presses Enter. The pane shows `Sign in to Claude subscription` with `Paste code`, `Browser callback`, and `Import from Claude Code` (`import-methods.txt`).
- **Import.** The drive sends `Down Down Enter`. The pane shows `Logged in to Claude subscription. Credentials saved to …/agent/auth.json` (`import-result.txt`). `auth.json` has mode `600` and holds exactly the synthetic access token, refresh token, and expiry, and the Claude credentials file hash is unchanged (`import-auth.json`).
- **Paste code.** The drive restarts Pi with an empty `auth.json`, reopens the menu, and presses Enter on **Paste code**. The pane shows the authorize URL (`paste-authorize.txt`). The `open` stub receives exactly one URL, and its parameters match `login-paste-url` (`paste-authorize-url.json`, with state and challenge masked).
- **Wrong sign-in.** The drive types `verify-code#not-this-sign-in` and presses Enter. The pane shows `Error: Failed to login to Claude subscription: That code is not from this sign-in…` (`paste-wrong-state.txt`), and `auth.json` has no `claude-subscription` entry.

## Gotchas

- After a successful import, Pi 1.5.2 also shows `Error: Logged in to Claude subscription, but no default model is configured for provider "claude-subscription". Use /model to select a model.` The credential is still saved. The drive does not treat this as a failure, but it is a real user-facing wart.
- Pi's login dialog spawns the browser opener detached. Its `open.log` entry can land after the pane renders, so poll the file rather than reading it once.
- Without `CLAUDE_CONFIG_DIR`, macOS import reads the real `Claude Code-credentials` Keychain item first, which is your session. Always keep the scratch `CLAUDE_CONFIG_DIR`.
- Without the `PATH` stub, Paste code and Browser callback open your real browser on `claude.com`.
- A correct `code#state` would POST to `platform.claude.com`. Only the wrong-state path is local. Never paste a real code in a drive.
- Browser callback is not driven. A local check could request `/callback?state=wrong&code=x` on the bound port and expect the `Sign-in failed` page, but nobody has written that yet.
