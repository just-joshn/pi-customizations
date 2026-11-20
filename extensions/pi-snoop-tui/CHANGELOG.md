# Changelog

## [0.1.2]

- Rewrite every test as a user behavior test. Tests load the extensions the way Pi does and assert the rendered tool rows, footer, header, and editor with the snoop themes. No behavior changes.

## [0.1.1]

- Refactor TUI components, row layout, and tests to adhere verbatim to `AGENTS.md` (immutable patterns, closure state cells, `zod` input validation, named constants, and small functions) with no behavior changes.
- Port pure data and CLI benchmark scripts (`medium-fixture`, `mixed-fixture`, `mockup-fixture`, `report`, `summary`, `profile-summary`, and `capture`) to TypeScript under `AGENTS.md`.

## [0.1.0]

- Add paired `snoop-dark` and `snoop-light` themes.
- Add compact rows for read, edit, write, bash, grep, find, and ls.
- Keep native tool detail rendering on expansion.
- Add compact rows for tools without renderers, with their arguments and plain output on expansion.
- Start every tool row's target in one column. Tool names longer than eight characters push only their own target.
- Add a single-line footer, workspace header, and static working indicator.
- List theme files without a glob, so loading the package skips Node's first `fs.globSync` call at startup.
- Cache rendered lines and tool summaries without extension-owned timers or render-time I/O.
- Pad and color expanded tool panels without a nested `Box`, and find blank edge lines without stripping every line, so Ctrl+O and typing with expanded rows do less work per row.
