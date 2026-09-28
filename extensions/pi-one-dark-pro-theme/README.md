# pi-one-dark-pro-theme

One Dark Pro Flat for [pi](https://pi.dev), computed from the pinned VS Code theme file.

## What you get

A single Pi theme, `one-dark-pro-flat`, mapped from
[Binaryify/OneDark-Pro](https://github.com/Binaryify/OneDark-Pro)
`themes/OneDark-Pro-flat.json`. All 56 color roles and the 3 HTML export colors are assigned.
Every value is derived from the pinned file under `upstream/` by `parity/theme.ts`, and
`npm run check:parity` fails when the committed theme drifts from a fresh build.

## Install

Install the package from this checkout:

```bash
pi install ./extensions/pi-one-dark-pro-theme
```

Or copy the theme file into your agent directory, which defaults to `~/.pi/agent`:

```bash
mkdir -p ~/.pi/agent/themes
cp extensions/pi-one-dark-pro-theme/themes/one-dark-pro-flat.json ~/.pi/agent/themes/
```

## Select the theme

Open `/settings`, choose Theme, and pick `one-dark-pro-flat`. To set it from the settings file:

```json
{
	"theme": "one-dark-pro-flat"
}
```

`pi --use-theme one-dark-pro-flat` selects it for one invocation without changing the saved
setting. `light/one-dark-pro-flat` pairs it with a light theme for terminals that follow the
system appearance.

## Verify parity

```bash
npm run build:theme    # rewrite themes/one-dark-pro-flat.json from upstream/
npm run check:parity   # pinned hash, schema coverage, committed theme, value shapes
npm run typecheck
npm run test:coverage  # 80% thresholds on parity/*.ts
npm run check:smoke    # launch pi in tmux and assert the theme's escapes reach the screen
```

`check:smoke` needs `tmux` and a `pi` on `PATH`, or `PI_BIN` set to one. It runs two isolated
agents with a fresh `HOME` and agent directory, captures the pane with escape sequences intact,
and loads the theme twice: once through `--theme` and once through the package manifest. It fails
if the built-in `dark` theme's accent appears, so a silent fallback cannot pass.

## No extension code

This package ships a theme JSON and nothing that runs inside Pi. Pi discovers themes through the
`pi.themes` manifest entry, so no extension can add a color or select a theme that the file and
`/settings` do not already own. `docs/parity.md` has the role-by-role evidence trail, the
derivation rules, and the measured contrast table.
