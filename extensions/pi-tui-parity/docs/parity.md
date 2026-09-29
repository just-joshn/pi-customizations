# Parity report: pi-tui-parity

Pi package `extensions/pi-tui-parity` (pi 0.99.1) recreating the TUI of
the reference agent CLI studied in the repository audit trail
(`.audit/pi-tui-parity`).

**Compatibility summary.** Visual and interaction parity is implemented for
everything that lives client-side in the terminal: theme palettes, chat
chrome, built-in tool UIs, the decision surface, mode/vim handling, the
command surface, pagers, notifications, and the rule wizard. Byte-for-byte
rendering parity with the reference CLI binary is not achieved and is not achievable:
pi's own TUI owns the render pipeline, and the reference CLI backend services do not
exist locally. Every research component is classified in
`parity/matrix.tsv` (362 components) as `implemented`, `mapped`, `deviation`,
or `unmet`; `bun run check:parity` enforces completeness.

## Implemented contracts

| Source contract | Pi implementation | Evidence |
| --- | --- | --- |
| Reference palettes (dark/light) for pi theme roles | Theme files `tui-dark`, `tui-light` in the package, validated against pi's 56-role schema | `themes/*.json`, schema check in test |
| the reference CLI-only tokens (pager accent `#F4E7A1`, decision purple `#A78BFA`, debug pink `#E34671`, diff row/inline backgrounds, composer/user-message//btw tints) and the tint mixing formula | Code palette keyed by active theme name; exact weighted-brightness mixing and ANSI256 nearest search over indices 16-255 | `src/palette.ts`, `test/palette.test.ts` |
| Shared UI constants (2/2/2/6/6/256/1MiB/2000/64000/50/50/5000ms/100ms/150), verb table, braille spinner frames at 250ms | `src/constants.ts`, asserted verbatim | `test/constants.test.ts` |
| AppHeader (bold title, dim version, padding row) | `ctx.ui.setHeader` | `src/chrome/header.ts`, `test/chrome.test.ts` |
| PromptFooter (mode headline row; model · context window · context% · files edited; right-aligned autorun label in ANSI magenta + vim label; cwd · branch location row) | `ctx.ui.setFooter` with `ReadonlyFooterDataProvider` branch subscription | `src/chrome/footer.ts` |
| Working status (green braille frames, 250ms) | `ctx.ui.setWorkingIndicator` with pre-colored frames | `src/chrome/working.ts` |
| Shell tool UI (`$ ` gutter, cwd note, duration/exit suffix, collapsed 2-line output with hidden hint, expanded 256 lines) | `pi.registerTool("bash")` delegating to `createBashTool`; stateful row via `ToolRenderContext.state` | `src/tools/renderers.ts`, `test/tools.test.ts` |
| Read/Edit/Grep/Glob/Ls tool UIs (progressive/past verbs, truncate-start paths, line notes, `+N -M` patch counts, ▎-bordered 12-line diff, 40-char pattern rule, Found N matches/files) | `pi.registerTool` delegating to the `create*Tool` originals | `src/tools/renderers.ts` |
| TodosUI (`✔`/`◐`/`○` rows, completed-first ordering, "Working on N to-do(s) • M done") | `todo_update` tool, list in tool-result details (branch-safe) | `src/tools/todos.ts`, `test/decisions.test.ts` |
| Tool DecisionSurface (top purple rule, bold purple titles "Run this command?"/"Write to this file?", option rows with hints, keys y/tab/n/p/esc/arrows) | `tool_call` handler returning `{block, reason}` + `ctx.ui.custom` surface | `src/decisions/*`, `test/decisions.test.ts` |
| Mode cycle (shift+tab ring default→plan→debug→ask), headline colors, vim insert/normal labels | Mode cycle and vim live in `ComposerEditor extends CustomEditor` (the runner reserves shortcut keys); headline in the footer | `src/editor/composer-editor.ts`, `src/state.ts` |
| Composer empty state (half-block `▄`/`▀` tint frame, dim `→` glyph, placeholder with inverse first character; "Plan, search, build anything" / "Add a follow-up") | ComposerEditor empty-state render; text-present rendering stays pi's editor | `src/editor/composer-editor.ts`, `test/editor.test.ts` |
| Slash command surface (64 entries, verbatim ids/aliases/descriptions; built-ins then dynamic push order) | `src/commands/registry.ts` data table; implemented entries registered via `pi.registerCommand`, mapped ids defer to pi builtins, unmet ids carry named reasons | `test/commands.test.ts` |
| `/help` output ("Commands:" header, `/id <args> - description` lines, hint line) | Implemented command | `src/commands/registry.ts` |
| Context pager (accent title, green percent, segmented bar with 0/25/50/75/100% scale, category rows, Free space) | `ctx.ui.custom` screen from `ctx.getContextUsage()` | `src/pagers/*`, `test/pagers.test.ts` |
| Copy-message picker (You/Agent prefix, 60-char preview, Enter to copy) | `ctx.ui.custom` + `getNativeClipboard()` | `src/pagers/pagers.ts` |
| Terminal notifications (OSC 9 / 777 notify / 99 base64 / BEL; DCS tmux passthrough; focus gating) | `agent_settled` + stdout escapes | `src/notify/osc.ts`, `test/notify.test.ts` |
| generate-rule wizard flow and result states | `/rule` via pi dialogs; target adapted from the reference CLI's rule files to AGENTS.md (project) or `<agent-dir>/AGENTS.md` (user) — pi's rule mechanism | `src/wizard/rule.ts`, `test/wizard.test.ts` |
| `/commit` prompt | Package prompt template exposed through the `pi.prompts` manifest key | `prompts/commit.md` |

## Mapped to pi (the reference CLI id → pi owner)

/model /resume /fork /compact /copy /name /new /quit /login /logout /settings
and the rest of pi's builtin command set resolve before extension commands
(`interactive-mode` onSubmit), so the extension never re-registers them.
/rewind maps to pi's `/tree`; /summarize to `/compact`; /clear to `/new`;
/debug stays pi's diagnostics. Transcript text, thinking, and compaction
rendering is pi's; the extension owns theme colors and tool rows only.

## Deviations (pi forbids the exact behavior)

| the reference CLI behavior | Rule that forbids it | What ships instead |
| --- | --- | --- |
| Ink/Yoga cell compositor, Static history, direct ANSI review painter | tui.md: "Do not create a second terminal renderer inside an extension" | pi's TUI renders; parity surfaces as components, renderers, and themes |
| Shift+Tab shortcut registration | runner.js reserved-keybinding list | Mode cycle handled inside ComposerEditor.handleInput |
| Custom theme color roles (decision purple, diff row backgrounds, tints) | theme-schema.json colors additionalProperties:false | `src/palette.ts` keyed by theme name |
| the reference CLI-only tokens as theme JSON | same schema rule | palette helpers emitting truecolor or ANSI256 nearest |
| Composer glyph column, inline paste/slash token styling, 6-line viewport, vim cursor styles when text present | pi's editor owns the canvas; replacing it would break IME/shortcut contracts (tui.md CustomEditor guidance) | Empty state fully the reference CLI-rendered; text-present state keeps pi's editor with the reference CLI frame borders |
| Live Thinking/Summarizing/verb working labels | pi owns the working row composition | Static "Working" label with the reference CLI spinner frames |
| MAX-mode label, PR hyperlink, custom statusLine command, exit-armed footer line | No pi equivalent (no max mode, no PR registry, pi owns exit flow) | Omitted |

## Unmet contracts (the reference CLI backend or services pi lacks)

| Source requirement | Why parity is unavailable |
| --- | --- |
| Login/onboarding against the reference CLI authentication | Needs the reference CLI API; pi authenticates providers its own way |
| Cloud agents, goal continuation, /detach persistent sessions | the reference CLI cloud lifecycle has no local equivalent |
| Teams, Bedrock config, usage dashboards, updater, feedback | the reference CLI account services |
| MCP servers pager, plugin marketplace | pi has no builtin MCP/plugin registry to enumerate |
| Sandbox runtime and Run-in-Sandbox approvals | pi has no sandbox runtime; Run Everything maps to the decision-gate bypass only |
| Semantic search, read-lints, image generation, AI attribution, web search/fetch tools | Need the reference CLI services (semantic-index, lints, image-generation, ai-attribution); pi tools cover bash/read/edit/write/grep/find/ls |
| Statsig tip pool | Server-configured content; the tip line is omitted rather than invented |
| Per-model slash commands for the reference CLI models | pi's model registry and Ctrl+P cycling own model selection |

## Gates

| Gate | Check |
| --- | --- |
| P1 matrix completeness | `bun run check:parity` (negative-controlled) |
| P2 component tests | `bun run test` — literal assertions against research values |
| P3/P4 live smoke | `bun run check:smoke` — real pi under tmux, captures asserted |
| P5 docs conformance | `bun run check:docs` (negative-controlled) |
| P6 quality | `bun run typecheck`, `bun run test:coverage` (80/80/80), wired into root `make verify` |
