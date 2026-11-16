# pi-anthropic-oauth-v2 verification map

This map is the maintained source for the extension's user-facing verification. Read [the skill](../SKILL.md) for launch, doctor, evidence, and cleanup. Cover each listed entry point separately; convenience paths do not prove the rest.

## Baseline preconditions

- Checkout dependencies installed; package tests and typecheck pass.
- Pi 1.5.2, Node >=22.19, Bun, and POSIX Python 3 available.
- A fresh `verify.py init "$E"` profile per journey, with no subscription login.
- `verify.py doctor "$E"` identifies that profile and unchanged source.
- `V` is the absolute path to `../scripts/verify.py`; `E` is the unique absolute evidence path.
- For interactive recipes, `TARGET` is the tmux session returned by this run's `tmux_run` job, never the parent agent's terminal.
- Live subscription journeys require user-approved browser sign-in into this disposable profile; no credential copying or invented login seed.

## Driving conventions

- Use the helper's isolated PTY for scripted commands and its foreground `run` through `tmux_run` for menus/human login.
- Send literal text with `tmux send-keys -t "$TARGET" -l 'text'`, then send `Enter` separately.
- Capture before and after each action with uniquely named `tmux capture-pane` files and log the action.
- Exact visible names, provider prefixes, and command strings are stable handles. Never assume row positions.
- Keep evidence after cleanup; never commit credential-bearing artifacts.

## Proof and skip reporting

- TUI proof: before transcript/screen, submitted action, resulting notice/selection/response.
- Print proof: argv, stdout, stderr, exit code.
- Mutation proof: independent read-only credential metadata/workspace checks; never include secret values.
- Zero-network proof: observer loaded in every driven Node process and no attempt records. Scope excludes external browsers and processes.
- Record feature ID and entry point. Missing credentials mean the authenticated journey is NOT VERIFIED, not passed via logged-out behavior.
- The only mandatory generator smoke journey is both logged-out usage entry points; login, authenticated usage, model requests, and all safety variants remain separate work.

## Features

- [Subscription sign-in and sign-out](login.md): provider picker, direct login, persisted account access, cancellation, isolated logout.
- [Select Claude and send a prompt](models.md): model picker, Ctrl+L, explicit CLI provider, unchanged built-in provider.
- [Claude plan usage](usage.md): logged-out TUI/print, authenticated limits and reset times, warnings and errors.
- [OAuth-only request safety](oauth-safety.md): ignored API-key environment, malformed credentials/configuration, custom-header refusal, supporting wire-boundary tests.
