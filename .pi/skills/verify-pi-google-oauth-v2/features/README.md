# Google AI subscription verification map

This is the maintained user-path map for `@justjoshn/pi-google-oauth-v2`. Read the parent [skill](../SKILL.md) for isolation, launch, doctor, evidence and cleanup. Variables `HELPER`, `EVIDENCE` and `TARGET` always refer to that run's absolute paths and owned tmux target.

## Baseline preconditions

- Native Pi 1.5.2 with the checkout extension explicitly loaded, a fresh scratch profile/workspace, and no other extensions or project instructions.
- Empty profile, offline mode: native available-model listing reports `No models available`. Pi 1.5.2 hides unconfigured providers. Baseline selector checks require real OAuth copied with `copy-auth` or a completed login; no catalog cache is seeded. No fixture files needed.
- Authenticated journeys additionally need the owner's real Google AI account/consent and reachable Google services. Credential copying bypasses login; it is never a sign-in pass.
- Run `python3 "$HELPER" doctor "$EVIDENCE"` before driving. Launch each TUI with `serve-tui` through `tmux_run`, never a shared user session. Resize its managed tmux pane to 150x50; send terminal input through scratch `tui.input`, not tmux `send-keys`.

## Driving conventions

Record literal actions and resulting panes in order, with model/provider identity. Wait for concrete text with bounded polling, not an unexplained sleep. CLI helper output artifacts include argv, stdout, stderr and exit status. Use a fresh profile for login; no fake provider or direct auth setter replaces it.

## Proof and failure reporting

Every entry point below is separate coverage. A CLI success does not prove the TUI selector; a copied-token request does not prove either login route. Report unmet preconditions with attempted action and reason. Missing credentials, unsupported catalog families, Google account validation, and 429s are failures/blocks of that journey, not reasons to weaken its assertions. Evidence survives cleanup outside scratch. Never retain credential files or authorization codes.

## Features

- [Sign in and out](login.md): `/login` picker, direct provider login, browser callback, Code page, cancellation, `/logout`.
- [Models and thinking](models-and-thinking.md): offline CLI baseline, `/model`, Ctrl+L, `/thinking`, Shift+Tab, authenticated catalog.
- [Native requests](requests.md): TUI streaming and CLI print/JSON, successful final response and honest provider errors.
- [Instructions and actual tool replay](instructions-and-tools.md): existing native-Pi live verifier for conflicts, forged roles, permitted requests, and two read-tool rounds; full-context release follow-up.
