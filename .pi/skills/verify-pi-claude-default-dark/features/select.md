# Theme selection

A user selects the theme for one run with `pi --use-theme claude-default-dark`, or saves it by picking it in `/settings` or writing `settings.json` `theme`. Pi renders the package's colors either way. The flag does not change saved settings and overrides the saved theme for that run. `/claude-theme use` is a third way to save it ([use.md](use.md)). If the saved theme fails to load, Pi falls back to `system`.

## Sub-features

- `use-theme-flag`: `--use-theme claude-default-dark` renders the theme's `muted` color and saves nothing (the drive starts with no saved `theme`, and none appears).
- `picker`: from a session on `dark`, `/settings` → Theme → `claude-default-dark` → Enter renders the theme's `muted` color, saves `theme: claude-default-dark`, and renders it again after a restart.
- `settings-theme`: `settings.json` `"theme": "claude-default-dark"` renders the theme's `muted` color.

## How to get to it (user POV)

- `pi --use-theme claude-default-dark`, or pick the theme in `/settings` (which writes `settings.json`).

## Driving it with control-claude-default-dark

Preconditions:

- `doctor` passes.

Steps:

- **Run.** `./.pi/skills/verify-pi-claude-default-dark/bin/control-claude-default-dark drive select`.
- **Act.** Install, start the TUI with `--use-theme claude-default-dark` and stop it. Write `theme: dark`, start the TUI, in `/settings` type `theme`, Enter on `→ Theme`, Down until `→ claude-default-dark` (at most 8 presses), Enter, stop, start again. Finally write `settings.json` `theme` and start once more.
- **Observe.** Every rendered pane contains the SGR for `colors.muted` (`\x1b[38;2;153;153;153m` for `#999999`). After the flag run `settings.json` has no `theme`; after the picker it is `claude-default-dark`.
- **Proof.** `artifacts/verify-pi-claude-default-dark/select/` holds `use-theme-flag.ansi`, `picker-selected.ansi`, `picker-restarted.ansi`, and `settings-theme.ansi`.

## Gotchas

- The probe needs a truecolor pane. The harness sets `COLORTERM=truecolor`; without it Pi approximates to 256 colors and the SGR differs.
- If `colors.muted` stops being a hex value, the probe cannot be built. `doctor` checks this first.
