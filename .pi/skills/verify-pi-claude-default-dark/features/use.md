# /claude-theme use

`/claude-theme use` switches the current session to `claude-default-dark` through Pi's `ctx.ui.setTheme`. It is how a user opts in without opening `/settings`.

## Sub-features

- `switch`: a session that started on `dark` shows the theme's `muted` color after `/claude-theme use`.
- `persist`: the choice is saved: `settings.json` `theme` becomes `claude-default-dark`. Pi's `setTheme` does the saving, but a user who runs `use` expects the choice to stick, so the drive asserts it.

## How to get to it (user POV)

- Type `/claude-theme use` in a Pi session where the package is installed.

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive use`.
- **Act.** Install, write `settings.json` `theme: dark`, start the TUI, type `/claude-theme use`.
- **Observe.** Before: no theme `muted` SGR on screen. After: the SGR is on screen. `settings.after-use.json` shows `theme: claude-default-dark`, and the drive fails otherwise.
- **Proof.** `artifacts/verify-pi-claude-default-dark/use/` holds `before-use.ansi`, `after-use.ansi`, and `settings.after-use.json`.

## Gotchas

- `/claude-theme use` prints nothing on success. Wait for the repaint (the drive waits 1.5 s) before capturing.
- When the theme fails to load, `use` shows Pi's error, Pi falls back to the `system` theme, and nothing is saved. The package's G9 gate covers that path.
