# pi-cursor-ui

A presentation-only skin for the pi interactive TUI. It changes how pi looks.
It does not change how pi behaves. The model, the system prompt, the tools, the
session data, and every keybinding stay exactly as they are without it.

## Load it

```sh
pi -e ./extensions/pi-cursor-ui
```

To load it in every session, add the package path to the `packages` list in
`~/.pi/agent/settings.json`. The `pi` manifest points at `./src/index.ts` and
`./themes/cursor-ui.json`.

## Tool coverage

Pi activates every tool an extension registers, including a tool the user never
selected. A same-name renderer for all eight built-ins would therefore add
`grep`, `find`, `ls`, and `powershell` to the model's tool set and change the
system prompt for everyone.

The skin registers `read`, `bash`, `edit`, and `write` by default. They are
exactly Pi's default active set, so the model sees no change. Run
`node scripts/check-prompt-parity.mjs` to compare a session with the skin
against a session without it.

To use the styled rows for the other four built-ins, name them in
`PI_CURSOR_UI_TOOL_OVERRIDES` and enable the same tools for pi:

```sh
PI_CURSOR_UI_TOOL_OVERRIDES=grep,find,ls,powershell pi -e ./extensions/pi-cursor-ui
```

## What owns each surface

- `src/index.ts` wires the store, the lifecycle handlers, the tool renderers,
  and the UI controller.
- `src/lifecycle/register-lifecycle.ts` turns Pi notifications into
  presentation state. It observes only.
- `src/state/presentation-state.ts` declares the state model.
  `src/state/presentation-store.ts` publishes immutable snapshots.
- `src/ui/` holds the header, footer, custom editor, working indicator, and the
  live activity widget, plus `install-ui.ts`, which installs and restores them.
- `src/tools/` registers the same-name built-in renderer overrides and
  delegates execution to the official definitions in `builtins.ts`.
- `src/format/` holds pure formatting. `duration.ts` renders elapsed time,
  `path.ts` shortens a home path, `width.ts` fits a line to the terminal.
- `themes/cursor-ui.json` sets every semantic theme role.
- `scripts/check-skin-boundaries.mjs` fails when the source calls a
  behavior-changing pi API or deep-imports a pi package.
- `scripts/check-prompt-parity.mjs` proves the system prompt, the tool
  definitions, and the reply do not change when the skin loads.
- `scripts/tmux-smoke.mjs` drives a real pi in tmux with a scripted local
  provider and writes captures under `artifacts/`.

## Palette

The theme reads `#3ed07a` as `success`. The editor border is green while the
agent is idle and `borderAccent` while it runs. Pi keeps its own border color in
`!` shell mode. The footer shows the real thinking level with a dot colored from
the `thinking*` roles, which travel green, violet, magenta across the levels.

## Verify

```sh
bun run typecheck
bun run test:coverage
bun run check:skin
node scripts/check-skin-boundaries.mjs --self-test
node scripts/check-prompt-parity.mjs
bun run check:smoke
```

`bun run check:smoke` needs `pi` and `tmux` on `PATH`. It runs every scenario
from `node scripts/tmux-smoke.mjs --list`, and writes one plain-text and one
ANSI capture per step under `artifacts/<scenario>/`. Run one scenario with
`node scripts/tmux-smoke.mjs --steps <name>`. From the repository root,
`make verify-cursor-ui` runs the offline checks.
