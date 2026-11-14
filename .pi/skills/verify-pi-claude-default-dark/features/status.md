# /claude-theme status

`/claude-theme status` (or bare `/claude-theme`) tells the user whether Pi knows a theme named `claude-default-dark`. It reports `claude-default-dark: installed; parity requires separate verification` when that name is in Pi's theme list, and the error `claude-default-dark: theme resource not found` when it is not. It is a name check: it does not say whether the theme is active or which source provided it. It never claims parity, and it only answers in the TUI (in print and RPC modes the command returns silently).

## Sub-features

- `installed`: the info message above, and no `parity PASS`, `parity passed`, or `parity certified` anywhere on screen.
- `bare`: in a fresh session, `/claude-theme` (accept the autocomplete, Enter) gives the installed message.
- `missing`: with a copy of the package whose `themes/` directory is removed, the error message above.

## How to get to it (user POV)

- Type `/claude-theme status` in a Pi session where the package is installed.

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive status`.
- **Act.** Install, start the TUI on `dark`, type `/claude-theme status`. Start a fresh TUI, type `/claude-theme`, accept the autocomplete with Enter, press Enter. Then copy the package without `development/` into the scratch dir, delete its `themes/`, install it into a second agent dir, start the TUI there, and type `/claude-theme status`.
- **Observe.** The exact info text twice (explicit and bare), then the exact error text.
- **Proof.** `artifacts/verify-pi-claude-default-dark/status/` holds `status-installed.ansi`, `status-bare.ansi`, and `status-missing.ansi`.

## Gotchas

- Pi shows only the latest notification. The bare check runs in a fresh session so the message can only come from that command.
- A same-named theme from another source also satisfies the installed message.
- Pi still loads the extension when its declared theme file is missing, so the command exists and can report the error. Pi itself may also warn about the missing resource.
- The copy skips `development/`, which holds a large `node_modules` the package does not need at runtime.
