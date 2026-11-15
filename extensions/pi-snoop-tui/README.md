# pi-snoop-tui

A compact look for Pi's interactive terminal UI. Paired light and dark themes use graphite neutrals and a soft blue accent.

Tool rows show a status marker, tool name, target, and result summary. Successful calls collapse to one line. Running bash calls show up to three output lines. Errors show up to five lines. Expand tools with your configured shortcut, normally Ctrl+O, to see Pi's native detail rendering.

The footer shows the workspace, branch, extension statuses, model, thinking level, and context usage on one line. The header shows `pi / workspace`. A static dot replaces the animated working indicator.

## Install

```sh
pi install npm:@justjoshn/pi-snoop-tui
```

Built and tested against Pi 1.5.2.

Add these recommended native settings to `~/.pi/agent/settings.json`:

```json
{
  "theme": "snoop-light/snoop-dark",
  "quietStartup": true,
  "hideThinkingBlock": true,
  "outputPad": 1,
  "editorPaddingX": 1,
  "collapseChangelog": true,
  "autocompleteMaxVisible": 5
}
```

The theme pair follows your terminal's light or dark appearance. Use `snoop-dark` or `snoop-light` to choose one explicitly. The package never writes your settings.

Run `pi config` to toggle `tool-rows.ts`, `footer.ts`, and `chrome.ts` independently. Chrome includes the header and working indicator. Tool rows also work with stock themes.

## Native limits

Pi owns the blank line between tool rows. This package cannot remove it through the native renderer API.

Your terminal owns the canvas background. For dark mode, set it near `okhsl(250 10% 9%)`. For light mode, use `okhsl(250 12% 97%)`.

Expanded content stays native, including syntax highlighting, diffs, and truncation notices. Read detail does not add line numbers. Edit previews appear after execution, not before it. Successful writes have no expanded source preview because Pi puts that content in its call renderer, which this package does not invoke. Unknown tools keep their existing renderers.

The footer replaces Pi's token and cost totals. It preserves other extensions' status messages, then shrinks or drops lower-priority segments when space is limited.

## Rendering work

The package starts no timers and performs no file or process operations. Collapsed rows memoize output summaries and only style bounded previews. Header and footer lines cache their rendered output. Context usage refreshes on lifecycle events, not on terminal frames.

A theme change clears component caches. The working dot takes the new theme color at the next agent start.

## Develop

```sh
bun install
bun run --filter @justjoshn/pi-snoop-tui typecheck
cd extensions/pi-snoop-tui
bunx vitest run --coverage
```

Tests cover Pi's call-before-result ordering, isolated native renderer state, cache invalidation, theme role parity, and terminal widths with CJK text and emoji.
