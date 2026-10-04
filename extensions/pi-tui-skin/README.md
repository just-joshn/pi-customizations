# pi-tui-skin

A presentation-only skin for the pi interactive TUI. It changes how pi looks.
It does not change how pi behaves. The model, the system prompt, the tools, the
session data, and every keybinding stay exactly as they are without it.

## Load it

```sh
pi -e ./extensions/pi-tui-skin
```

To load it in every session, add the package path to the `packages` list in
`~/.pi/agent/settings.json`. The `pi` manifest points at `./src/index.ts` and
`./themes/tui-skin.json`.

## Tool coverage

The skin uses Pi 1.0.2's `pi.registerToolRenderer()` for `read`, `bash`,
`edit`, `write`, `grep`, `find`, `ls`, and `powershell`. It registers no tool
definitions and does not change which tools are active. Pi owns execution,
settings, schemas, and the model's tool declarations.

Run `node scripts/check-prompt-parity.mjs` to compare a session with the skin
against a session without it. Enable optional tools through Pi's `--tools`
flag or `defaultTools` setting. The skin styles them automatically:

```sh
pi -e ./extensions/pi-tui-skin --tools read,bash,edit,write,grep,find,ls,powershell
```

`PI_TUI_SKIN_TOOL_OVERRIDES` is no longer needed. Unknown tool names retain
the renderers supplied by later extensions or Pi.

## What owns each surface

- `src/index.ts` wires the store, the lifecycle handlers, the tool renderers,
  and the UI controller.
- `src/lifecycle/register-lifecycle.ts` turns Pi notifications into
  presentation state. It observes only.
- `src/state/presentation-state.ts` declares the state model.
  `src/state/presentation-store.ts` publishes immutable snapshots.
- `src/ui/` holds the header, footer, custom editor, working indicator, and the
  live activity widget, plus `install-ui.ts`, which installs and restores them.
  The composer paints the reference's `→` glyph inside Pi's `paddingX` on the
  first input row, so the text column, mouse hits, and the hardware cursor all
  agree with what Pi subtracts.
  The header prints a title, pi's `VERSION`, and one rotating tip, indented two
  columns the way the reference indents its own banner. The footer shows a mode
  row only once the thinking level leaves its session-start value, then the
  model row, then the location row.
- `src/tools/` resolves built-in tool renderers through Pi's native API.
  It does not wrap execution or read tool settings.
- `src/format/` holds pure formatting. `duration.ts` renders elapsed time,
  `path.ts` shortens a home path, `width.ts` fits a line to the terminal.
- `themes/tui-skin.json` sets every semantic theme role.
- `scripts/check-skin-boundaries.mjs` fails when the source calls a
  behavior-changing pi API or deep-imports a pi package.
- `scripts/check-prompt-parity.mjs` proves the system prompt, the tool
  definitions, and the reply do not change when the skin loads.
- `scripts/tmux-smoke.mjs` drives a real pi in tmux with a scripted local
  provider and writes captures under `artifacts/`.

## Compare against the installed reference

The baseline under `reference/reference-agent-<build>/` is captured from the
installed `reference-agent` with `tmux capture-pane`, so parity is a text diff and
not an eyeball. `scripts/compare-reference.mjs` derives its expectations from
the reference frame and reports each difference by name.

```sh
node scripts/capture-reference.mjs            # re-capture the baseline for the installed build
node scripts/capture-reference.mjs --check    # fail when the installed build drifted from the baseline
node scripts/compare-reference.mjs --known "location PR segment"
```

`.audit/pi-tui-skin/parity-inventory.md` lists every known difference, what
closed it, and the ones left open with the reason.

## Palette

The composer is a two-row half-block band drawn in `borderMuted`, which this theme maps to
`composerFill` (`#151515`, the fill measured from the installed reference). The band keeps
that color in every phase, including while the agent runs, where the state shows up as the
animated `Working` label inside the top band instead. Pi keeps its own `bashMode` accent
for a `!` shell prefix. The activity widget's dot and the peak frame of the working
indicator read `success` (`#3ed07a`). The footer's mode line prints the real thinking level
with its `(shift+tab to cycle)` hint in that level's `thinking*` role, which travels from
green through violet to magenta.

## Verify

```sh
bun run typecheck
bun run test:coverage
bun run check:skin
node scripts/check-skin-boundaries.mjs --self-test
node scripts/check-prompt-parity.mjs
node scripts/lib/frame-invariants.mjs --self-test
bun run check:reference
bun run check:smoke
```

`bun run check:smoke` needs `pi` and `tmux` on `PATH`. It runs every scenario
from `node scripts/tmux-smoke.mjs --list`, and writes one plain-text and one
ANSI capture per step under `artifacts/<scenario>/`. Run one scenario with
`node scripts/tmux-smoke.mjs --steps <name>`. From the repository root,
`make verify-tui-skin` runs the offline checks.
