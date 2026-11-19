# pi-anthropic-oauth-v2 verification map

This map is the maintained source for the extension's user-facing verification. Read [the skill](../SKILL.md) for launch, doctor, evidence, and cleanup. Cover each listed entry point separately. A convenience path does not prove the others.

The extension registers one provider, `custom-anthropic`. It signs in with a Claude Pro or Max account through `/login`, or reads an API key from `CUSTOM_ANTHROPIC_API_KEY`. Its models come from Pi's built-in Anthropic catalog with ` (Custom)` added to each name.

## Baseline preconditions

- Checkout dependencies installed; package tests and typecheck pass.
- Pi 1.5.2, Node >=22.19, Bun, and POSIX Python 3 available.
- A fresh `verify.py init "$E"` profile per journey, with no login.
- `verify.py doctor "$E"` identifies that profile and unchanged source.
- `V` is the absolute path to `../scripts/verify.py`; `E` is the unique absolute evidence path.
- For interactive recipes, `TARGET` is the tmux session returned by this run's `tmux_run` job, never the parent agent's terminal.
- Live subscription journeys require user-approved browser sign-in into this disposable profile; no credential copying or invented login seed.

## Driving conventions

- Use the helper's isolated PTY (`drive`) for scripted steps. An empty step text sends a bare Enter, which selects the highlighted menu row.
- Use the foreground `run` through `tmux_run` for human sign-in.
- Send literal text with `tmux send-keys -t "$TARGET" -l 'text'`, then send `Enter` separately.
- Capture before and after each action with uniquely named `tmux capture-pane` files and log the action.
- Wait for text Pi prints in response, never for text that also appears in the typed command. For example, wait for the footer `claude-opus-4-6 •`, not `claude-opus-4-6`.
- Keep evidence after cleanup; never commit credential-bearing artifacts.

## Proof and skip reporting

- TUI proof: before transcript, submitted action, resulting menu, prompt, or footer.
- CLI proof: argv, stdout, stderr, exit code.
- Zero-network proof: observer loaded in every driven Node process and no attempt records. Scope excludes external browsers.
- `--fake-api-key` sets `CUSTOM_ANTHROPIC_API_KEY` to the invalid `sk-ant-api03-VERIFY-FAKE`. It makes models available offline and gets a real 401 from Anthropic. It never proves a successful request.
- Record feature ID and entry point. Missing credentials make an authenticated journey NOT VERIFIED, not passed through logged-out behavior.
- The mandatory smoke journey is login picker, missing-credentials print, and fake-key error print. Everything else is separate work.

## Features

- [Sign in and sign out](login.md): `/login` picker, direct `/login custom-anthropic`, account code flow, API-key option, logout.
- [Models](models.md): catalog listing, `/model` picker, direct switch, CLI `--model`, real response, thinking.
- [Requests and errors](requests.md): missing credentials, API-key requests, error rendering, the local wire check.
