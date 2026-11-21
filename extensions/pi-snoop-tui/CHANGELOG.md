# Changelog

## 0.1.5

- Update `README.md`, `CHANGELOG.md`, and `bench/` docs to match the current tool rows, footer behavior, editor labels, and TypeScript benchmark scripts, and tighten the prose.

## 0.1.4

- Include indent, frame tone, and theme in the panel cache key so mid-session `outputPad` and theme changes re-render without manual invalidation.
- Replace the hand-written ANSI blank-line scanner with `stripTerminalSequences`, use `os.homedir()` in `rows/specs.ts`, make `footer.ts` table-driven, and share a `memoLast` cache helper.

## 0.1.3

- Fix two lint errors. The editor inset no longer passes a negative count to `repeat()`. The home directory is read when a path is shown, not when the module loads.

## 0.1.2

- Rewrite every test as a user behavior test. The tests load the extensions the way Pi does and assert the rendered tool rows, footer, header, and editor with the snoop themes.
- Change no behavior.

## 0.1.1

- Refactor the TUI components, row layout, and tests to use immutable patterns, closure state cells, `zod` input validation, named constants, and small functions. Change no behavior.
- Port the pure data and CLI benchmark scripts to TypeScript: `medium-fixture`, `mixed-fixture`, `mockup-fixture`, `report`, `summary`, `profile-summary`, and `capture`.

## 0.1.0

- Add paired `snoop-dark` and `snoop-light` themes.
- Add compact rows for `read`, `edit`, `write`, `bash`, `grep`, `find`, and `ls`.
- Keep native tool detail rendering on expansion.
- Add compact rows for tools without renderers. Expanded, they show their arguments and plain output.
- Start every tool row's target in one column. A tool name longer than eight characters pushes only its own target.
- Add a single-line footer, a workspace header, and a static working indicator.
- List theme files without a glob, so loading the package skips Node's first `fs.globSync` call at startup.
- Cache rendered lines and tool summaries. The package uses no timers and does no I/O at render time.
- Pad and color expanded tool panels without a nested `Box`, and find blank edge lines without stripping every line. Ctrl+O and typing with expanded rows do less work per row.
