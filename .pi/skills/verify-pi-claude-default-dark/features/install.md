# Install and discovery

A user installs the package from a local path with `pi install`. Pi records the path in `settings.json` without copying the package, lists it in `pi list`, offers `claude-default-dark` in the `/settings` theme picker next to Pi's own themes, and registers `/claude-theme` (see [status.md](status.md) and [use.md](use.md)). Installing does not select the theme.

## Sub-features

- `install`: `pi install <path>` exits 0 and `settings.json` `packages` resolves to the package directory.
- `list`: `pi list` prints `pi-claude-default-dark`.
- `picker`: `/settings`, search `theme`, Enter opens the Theme list, which contains a `claude-default-dark` row.

## How to get to it (user POV)

- Run `pi install ./extensions/pi-claude-default-dark`, then `pi list`, then open Pi and choose `/settings` → Theme.

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive install`.
- **Act.** `pi install <package>`, `pi list`, then in the TUI `/settings`, type `theme`, Enter.
- **Observe.** `settings.json` `packages`, resolved from the agent dir, is the package; `pi list` names it; the Theme list shows a line that is exactly `claude-default-dark`. This proves discovery, not rendering. [select.md](select.md) proves rendering.
- **Proof.** `artifacts/verify-pi-claude-default-dark/install/` holds `install.txt`, `list.txt`, `settings.after-install.json`, and `theme-picker.ansi`.

## Gotchas

- `pi install` writes the package path relative to the agent dir (`../../…/extensions/pi-claude-default-dark`). Resolve it against the agent dir, not the cwd, before comparing.
- `/settings` opens on `Auto-compact`. The Theme row only appears after typing `theme` into its search.
- The picker check matches a whole line. The default scratch cwd (`verify-pi-cdd-*`) does not contain `claude-default-dark`, but a custom `--out` or cwd can, and then a bare substring would match Pi's footer.
