# pi-cursor-ui: design and decision trail

Package: `extensions/pi-cursor-ui`. Contract: `extensions/pi-cursor-ui/docs/PI_CURSOR_UI_IMPLEMENTATION_SPEC.md`.

## Goal and predicate

Ship a presentation-only Pi package that makes Pi 0.87.1 look like the reference
video as far as the documented extension API allows, while changing no agent
behavior. Done is a falsifiable predicate:

1. `pi` loads the package with no extension or theme warnings.
2. `tsc --noEmit` passes.
3. `vitest run` passes, including an execution-equivalence test that compares
   every wrapped built-in tool against the official definition it spreads.
4. A live tmux run exercises a prompt, streaming, escape cancellation, steering,
   alt+enter follow-up, shift+tab thinking cycling, `/`, `@`, `!`, `!!`, every
   overridden tool row, expansion, resize, `/reload`, fullscreen, and print mode.
5. `scripts/check-skin-boundaries.mjs` reports no forbidden API use.
6. The diff adds no new model-callable capability and no persisted presentation
   state.

## Rigor

High on verification, low on invention. The design is fixed by the spec, so no
design arena was run; the risk lives in behavior preservation and in live
rendering, so the effort went into the equivalence test, the skin-boundary lint,
and the tmux driver.

## Reference palette

Measured from `~/Desktop/cursor-cli.mov` with ffmpeg frame sampling:

| Element | Sample |
|---|---|
| window background | `#171411` |
| body text | `rgb(181,187,181)` |
| idle editor border | `rgb(63,148,88)` |
| working status dot | `rgb(0,201,66)` |
| idle status dot | `rgb(55,222,118)` |
| cloud accent dot | `rgb(159,127,255)` |
| busy editor border | `rgb(108,91,157)` |

## Key design decisions

| Decision | Why | Alternative rejected |
|---|---|---|
| New workspace package `extensions/pi-cursor-ui` | The repo globs `extensions/*`; the spec names the package `pi-cursor-ui`; a separate package keeps the existing `pi-tui-parity` behavior-changing decisions out of this strict skin | Adding the skin to `pi-tui-parity`, which already installs a tool-blocking decision gate |
| Editor border color comes from the agent phase, with a bash-mode exception | The spec requires a green idle border and an alternate color for a real Pi state. Pi owns `borderColor` and sets it from the thinking level or from the `!` bash prefix. The editor sets success green while idle and `borderAccent` while running, and leaves Pi's value alone when the text starts with `!`, so bash mode keeps its own color | Leaving `borderColor` untouched, which renders the border in the thinking-level color and never green at a medium level |
| No vertical editor borders | Pi draws horizontal rules only. Adding side bars would shift the editor's mouse hit-testing by one column, which is a behavior change to `CustomEditor` | Wrapping every line, accepting a one-cell cursor-placement regression |
| Register four built-in overrides by default, the other four behind an environment variable | Pi activates every tool an extension registers (`_refreshToolRegistry` pushes every registered extension tool into the active set, and the factory cannot read `pi.getActiveTools()` because actions throw before the runtime binds). Registering all eight changed the model's tool set, the tool list in the system prompt, and the rules section. `read`, `bash`, `edit`, and `write` are Pi's default active set, so they are safe; `PI_CURSOR_UI_TOOL_OVERRIDES` opts in to `grep`, `find`, `ls`, and `powershell` for a user who enabled them | Registering all eight, which changed what the model sees, or calling `pi.setActiveTools()`, which the spec's strict skin rule forbids |
| `renderShell: "self"` on every tool override | Removes the default padded, background-colored box so a row is one compact line. Pi still inserts one blank line above each self-rendered row, so rows are spaced | Keeping the default shell and theming the backgrounds to near-black, which keeps the box padding and still renders three lines per row |
| Collapsed tool results render zero lines | `Text('')` renders `[]`, so a completed row stays one line; expansion reveals the real output | Always rendering a summary line, which doubles row height |
| All parsing happens in `renderCall`/`renderResult` | Pi wraps the factory call in try/catch but not the returned component's `render()`, where a throw crashes Pi | Lazy parsing inside the component |
| Activity widget subscribes and calls `tui.requestRender()` | Factories run once and the host does not dispose a custom editor, so one subscription lives in the install controller | Per-component store subscriptions, which would leak the editor's |
| `create*ToolDefinition` spread for the overrides | Preserves `promptSnippet`, `promptGuidelines`, `executionMode`, `prepareArguments`, `constrainedSampling`, and `label`, so the system prompt and execution stay identical | Copying fields by hand, as the official `minimal-mode.ts` example does, which drops prompt contributions |

## Trail

| ts | phase | decision | why | evidence | result |
|---|---|---|---|---|---|
| 2026-09-28T19:10Z | frame | Read the spec in full, then grounded on Pi 0.87.1 docs, public `.d.ts`, and the official examples | The contract's precedence rule makes the installed documentation authoritative | docs/{extensions,tui,themes,packages}.md; dist/index.d.ts; dist/core/extensions/types.d.ts; examples/extensions/{built-in-tool-renderer,minimal-mode,custom-footer,border-status-editor}.ts | grounded |
| 2026-09-28T19:12Z | how | Ran the `how` skill over the extension UI composition and tool override path | Needed the real lifecycle for install/uninstall, invalidation, and `renderShell` before choosing the shape | `/tmp/pi-cursor-ui-how.md` from the explainer; findings confirmed in `interactive-mode.js`, `tool-execution.js`, `custom-editor.js` | grounded |
| 2026-09-28T19:13Z | design | Skipped the architect arena | The spec fixes the module boundaries and types; an arena over a settled contract is over-engineering | spec sections 8 to 21 | n/a |
| 2026-09-28T19:15Z | unit 1 | Package, theme, state store, format helpers, skin-boundary lint, tmux driver | Scaffold and verification before features | `bun run typecheck`, `vitest run` 56 passed, `check:skin` 0 violations, real `validateThemeJson` accepted the theme, coverage 95.7/91.5/100/97.4 | verified |
| 2026-09-28T19:19Z | unit 3 | Eight same-name tool overrides delegating to the official definitions | The tools are where a skin can silently change behavior | 7 tools proven byte-identical on content/details/errors; metadata identical for all 8; powershell skipped on darwin | verified |
| 2026-09-28T19:25Z | unit 2 | Entry point, lifecycle observation, chrome components | Presentation surfaces on documented hooks only | see the verification trail | verified |
| 2026-09-28T19:36Z | verify | Live tmux matrix found two defects: the idle border rendered the thinking-level color, and registering all eight built-ins changed the active tool set and the system prompt | A skin that changes the prompt is not a skin | `scripts/check-prompt-parity.mjs`, `scripts/tmux-smoke.mjs --all` | fixed in unit 5, re-verified |
| 2026-09-28T19:45Z | verify | Registered four built-ins by default and kept the other four behind `PI_CURSOR_UI_TOOL_OVERRIDES` | Preserves the model-facing tool set while keeping the styled rows reachable | `parity: system prompt, 4 tool definitions, and reply identical (read, bash, edit, write)` | verified |
| 2026-09-28T19:50Z | verify | 20 live scenarios pass with 48 captures, and all offline gates pass | The real artifact works, not just the compiler | see `verification.md` | verified |
