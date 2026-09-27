# pi-reference-cli

Reference Agent CLI TUI parity for [pi](https://pi.dev) 0.87.1. Recreates the
look and behavior of the Reference Agent CLI (build 2026.09.26-dd393fe) on pi's
official extension mechanisms: a pi package with one extension, two themes,
and a prompt template.

## What you get

- **Themes** `reference-dark` and `reference-light`: Reference's palette mapped onto
  pi's theme roles (Markdown, diffs, syntax, tool rows, selection).
- **Chrome**: Reference header, footer (model · context% · files edited ·
  cwd · branch, autorun and vim labels), and the green braille working
  spinner.
- **Editor**: Reference's composer frame (half-block tint rows, arrow glyph,
  placeholders), shift+tab mode cycling (plan → debug → ask), and vim
  insert/normal with the footer indicator.
- **Tool UIs**: Reference-style rows for bash, read, edit, write, grep, find,
  and ls, plus the `todo_update` tool with Reference's TodosUI rows.
- **Decisions**: Reference's approval surface for bash/edit/write with
  allowlist and Run Everything bypass.
- **Commands**: the Reference slash-command surface — implemented commands,
  pi-built-in mappings, and documented unmet ids — plus /context, /usage,
  and /copy pagers.
- **Notifications**: terminal notifications with Reference's per-terminal
  escapes and focus gating.
- **/rule**: the generate-rule wizard writing AGENTS.md.

## Install

Load the extension directly:

```bash
pi --extension ./extensions/pi-reference-cli/src/index.ts
```

or install the package (extensions, themes, and prompts load via the `pi`
manifest key) and pick the `reference-dark` / `reference-light` theme in
`/settings` (use `reference-light/reference-dark` to follow the terminal).

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
Reference service; the service is named).
