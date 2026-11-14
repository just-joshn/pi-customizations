# /claude-theme verify

`/claude-theme verify` compares the active theme's colors with the colors the package ships, role by role, and says which match. With `claude-default-dark` active it reports every role matching and `Different roles (0): none.` With any other theme it names that theme and lists the roles that differ. It always adds that parity is certified only by `development/PARITY_REPORT.md`, never by this check. If Pi has no `claude-default-dark` theme loaded, it reports `claude-default-dark: theme resource not found` instead. It changes nothing and saves nothing. Any other subcommand shows `Usage: /claude-theme [status|use|verify]`.

## Sub-features

- `active`: under `--use-theme claude-default-dark`, `Active theme claude-default-dark.`, `Matching roles (N):` where N is the number of roles in `themes/claude-default-dark.json` (56), `Different roles (0): none.`, and the parity disclaimer.
- `other-theme`: under `--use-theme dark`, `Active theme dark.` and a non-empty `Different roles (k):` list; `settings.json` still has no `theme`.
- `usage`: `/claude-theme bogus` shows the usage warning.

## How to get to it (user POV)

- Type `/claude-theme verify` in a Pi session where the package is installed.

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive verify`.
- **Act.** Install. Start the TUI with `--use-theme claude-default-dark` and type `/claude-theme verify`. Start a fresh TUI with `--use-theme dark` and type it again. Start another on `dark` and type `/claude-theme bogus`.
- **Observe.** The texts above. The message is long and Pi wraps it, so the drive matches with `\s+` between words.
- **Proof.** `artifacts/verify-pi-claude-default-dark/verify/` holds `verify-active.ansi`, `verify-dark.ansi`, and `usage.ansi`.

## Gotchas

- The check compares resolved colors, so it proves the active theme carries the shipped values. It does not prove what Claude Code shows; that is the parity gates' job.
- The role count comes from the theme file at drive time. If roles are added, the expected count moves with them.
