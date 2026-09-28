# pi-tui-parity

TUI parity layer for [pi](https://pi.dev) 0.87.1. Recreates the look and
behavior of the reference agent CLI studied in the repository audit trail,
using only pi's official extension mechanisms: a pi package with one
extension, two themes, and a prompt template.

## What you get

- **Themes** `tui-dark` and `tui-light`: the reference palette mapped onto
  pi's theme roles (Markdown, diffs, syntax, tool rows, selection).
- **Chrome**: reference header, footer (model · context% · files edited ·
  cwd · branch, autorun and vim labels), and the green braille working
  spinner.
- **Editor**: reference composer frame (half-block tint rows, arrow glyph,
  placeholders), shift+tab mode cycling (plan → debug → ask), and vim
  insert/normal with the footer indicator.
- **Tool UIs**: reference-style rows for bash, read, edit, write, grep, find,
  and ls, plus the `todo_update` tool with reference todo rows.
- **Decisions**: the reference approval surface for bash/edit/write with
  allowlist and Run Everything bypass.
- **Commands**: the reference slash-command surface — implemented commands,
  pi-built-in mappings, and documented unmet ids — plus /context, /usage
  pagers.
- **Notifications**: terminal notifications with the reference per-terminal
  escapes and focus gating.
- **/rule**: the rule wizard writing AGENTS.md.

## Install

Load the extension directly:

```bash
pi --extension ./extensions/pi-tui-parity/src/index.ts
```

or install the package (extensions, themes, and prompts load via the `pi`
manifest key) and pick the `tui-dark` / `tui-light` theme in `/settings`
(use `tui-light/tui-dark` to follow the terminal).

## Verify

```bash
bun run typecheck
bun run test
bun run test:coverage   # 80/80/80 gates
bun run check:docs      # pi API conformance
bun run check:parity    # matrix completeness
bun run check:smoke     # live tmux smoke (needs tmux)
```

## Credits

Visual reference: the Cursor Agent CLI. This package recreates its terminal
look and interaction patterns on pi; credit for the original design belongs
to the Cursor CLI team.

## Parity status

See `docs/parity.md` and `parity/matrix.tsv`: every component in the
research inventory is `implemented`, `mapped` (pi owns it), `deviation`
(pi forbids the exact behavior; the rule is named), or `unmet` (needs a
service pi lacks; the service is named).
