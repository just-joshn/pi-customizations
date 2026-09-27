# pi-cursor-cli

Cursor Agent CLI TUI parity for [pi](https://pi.dev) 0.87.1. Recreates the
look and behavior of the Cursor Agent CLI (build 2026.09.26-dd393fe) on pi's
official extension mechanisms: a pi package with one extension, two themes,
and a prompt template.

## What you get

- **Themes** `cursor-dark` and `cursor-light`: Cursor's palette mapped onto
  pi's theme roles (Markdown, diffs, syntax, tool rows, selection).
- **Chrome**: Cursor header, footer (model · context% · files edited ·
  cwd · branch, autorun and vim labels), and the green braille working
  spinner.
- **Editor**: Cursor's composer frame (half-block tint rows, arrow glyph,
  placeholders), shift+tab mode cycling (plan → debug → ask), and vim
  insert/normal with the footer indicator.
- **Tool UIs**: Cursor-style rows for bash, read, edit, write, grep, find,
  and ls, plus the `todo_update` tool with Cursor's TodosUI rows.
- **Decisions**: Cursor's approval surface for bash/edit/write with
  allowlist and Run Everything bypass.
- **Commands**: the Cursor slash-command surface — implemented commands,
  pi-built-in mappings, and documented unmet ids — plus /context, /usage,
  and /copy pagers.
- **Notifications**: terminal notifications with Cursor's per-terminal
  escapes and focus gating.
- **/rule**: the generate-rule wizard writing AGENTS.md.

## Install

Load the extension directly:

```bash
pi --extension ./extensions/pi-cursor-cli/src/index.ts
```

or install the package (extensions, themes, and prompts load via the `pi`
manifest key) and pick the `cursor-dark` / `cursor-light` theme in
`/settings` (use `cursor-light/cursor-dark` to follow the terminal).

## Verify

```bash
npm run typecheck
npm test
npm run test:coverage   # 80/80/80 gates
npm run check:docs      # pi API conformance
npm run check:parity    # matrix completeness
npm run check:smoke     # live tmux smoke (needs tmux)
```

## Parity status

See `docs/parity.md` and `parity/matrix.tsv`: every component in the
research inventory is `implemented`, `mapped` (pi owns it), `deviation`
(pi forbids the exact behavior; the rule is named), or `unmet` (needs a
Cursor service; the service is named).
