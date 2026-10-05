# pi-one-dark-pro-theme

One Dark Pro Flat for [pi](https://pi.dev), computed from the pinned VS Code theme file.

## What you get

A single Pi theme, `one-dark-pro-flat`, mapped from
[Binaryify/OneDark-Pro](https://github.com/Binaryify/OneDark-Pro)
`themes/OneDark-Pro-flat.json`. All 56 color roles and the 3 HTML export colors are assigned.
Every value is derived from the pinned file under `upstream/` by `parity/theme.ts`, and
`bun run check:parity` fails when the committed theme drifts from a fresh build.
`upstream/provenance.json` retains the authentic original bytes in its `originalSource` string.
The checker verifies the unchanged original SHA-256 and requires the actual upstream artifact
to equal the shared root Biome transform of those bytes. See `upstream/SOURCE.md` for replay instructions.

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
bun run build:theme    # rewrite themes/one-dark-pro-flat.json from upstream/
bun run check:parity   # pinned hash, schema coverage, committed theme, value shapes
bun run typecheck
bun run test:coverage  # configured src/**/*.ts denominator is empty for this theme-only package
bun run test --coverage --coverage.include='parity/**/*.ts' --coverage.thresholds.lines=80 --coverage.thresholds.functions=80 --coverage.thresholds.branches=80 --coverage.thresholds.statements=80
bun run check:smoke    # launch pi in tmux and assert the theme's escapes reach the screen
```

`check:smoke` needs `tmux` and a `pi` on `PATH`, or `PI_BIN` set to one. It runs two agents with
a fresh `HOME`, agent directory, and workspace, so nothing from your own pi configuration can
leak in. Each run captures the pane with escape sequences intact and loads the theme, once
through `--theme` and once through the package manifest. A scripted provider in
`test/harness/scripted-provider.ts` drives one offline turn, which paints the user message box,
the tool box, and the final text, so no credentials or network are needed. The load-bearing
assertion is that the built-in `dark` theme's accent never appears, which fails a silent fallback
to `dark`.

## No extension code

This package ships a theme JSON and nothing that runs inside Pi. Pi discovers themes through the
`pi.themes` manifest entry, so no extension is needed to load it. An extension can call
`ctx.ui.setTheme` to select a loaded theme, but that selects what the file already defines, and
nothing in this package needs to run inside pi. `docs/parity.md` has the role-by-role evidence trail, the
derivation rules, and the measured contrast table.
