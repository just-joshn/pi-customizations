# pi-snoop-tui

A compact look for Pi's interactive terminal UI. Paired light and dark themes use graphite neutrals and a soft blue accent. The header, transcript, editor, and footer share one gutter on both sides, set by Pi's `outputPad` setting.

Tool rows show a status marker, tool name, target, and result summary. Successful calls collapse to one line. Running bash calls show up to three output lines. Errors show up to five lines. Expand tools with your configured shortcut, normally Ctrl+O, to see Pi's native detail rendering.

The footer shows the workspace, branch, extension statuses, model, thinking level, and context usage on one line. The header shows `pi / workspace`.

The editor sits between two thin rules. The top rule ends with `ready`, or `● working` while the agent runs. Pi's retry, compaction, and branch summary messages appear in the same place. A `›` prompt marks the first line, and the text starts in the same column as tool names. User messages in the transcript get the same `›`, unless they start with Markdown block syntax. In bash mode the rules take the theme's bash color.

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
  "collapseChangelog": true,
  "autocompleteMaxVisible": 5
}
```

The theme pair follows your terminal's light or dark appearance. Use `snoop-dark` or `snoop-light` to choose one explicitly. The package never writes your settings.

The editor layout replaces the `editorPaddingX` setting. If another extension already set a custom editor, this package leaves it in place and keeps its own header and footer. Pi assigns its callbacks, key handlers, and border color directly onto the editor instance, so a wrapper around another extension's editor cannot keep them in sync.

Run `pi config` to toggle `tool-rows.ts`, `footer.ts`, and `chrome.ts` independently. Chrome includes the header, the editor, the user prompt marker, and the working state. Tool rows also work with stock themes.

## Native limits

Pi owns the blank line between tool rows. This package cannot remove it through the native renderer API.

Your terminal owns the canvas background. For dark mode, set it near `#14151a`. For light mode, use `okhsl(250 12% 97%)`.

Expanded content stays native, including syntax highlighting, diffs, and truncation notices. Read detail does not add line numbers. Edit previews appear after execution, not before it. Successful writes have no expanded source preview because Pi puts that content in its call renderer, which this package does not invoke. Other tools keep their own renderers. A tool with no renderer of its own, such as `codemode`, `pi_spawn`, or an MCP tool before its server connects, gets the same one-line row: its name, its main string argument, and the size of its output. Expanded, it shows the arguments as compact JSON and the full plain-text output.

The footer replaces Pi's token and cost totals. It preserves other extensions' status messages, then shrinks or drops lower-priority segments when space is limited.

## Rendering work

The package starts no timers and performs no file or process operations. Collapsed rows memoize output summaries and only style bounded previews. Header and footer lines and the editor rules cache their rendered output. Context usage refreshes on lifecycle events, not on terminal frames.

A theme change clears component caches.

## Develop

```sh
bun install
bun run --filter @justjoshn/pi-snoop-tui typecheck
cd extensions/pi-snoop-tui
bunx vitest run --coverage
```

Tests cover the shared gutter, editor rules and status labels at every width, the user prompt marker, Pi's call-before-result ordering, isolated native renderer state, cache invalidation, theme role parity, and terminal widths with CJK text and emoji.
