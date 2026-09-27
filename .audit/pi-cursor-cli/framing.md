# pi-cursor-cli framing

## Goal

A Pi package, `extensions/pi-cursor-cli`, that makes Pi 0.87.1 look and behave like the Cursor Agent CLI TUI documented in `~/.cursor/research/cursor-cli-2026.09.26-dd393fe`. Every capability uses the smallest official Pi mechanism that owns it.

## Definition of done

Each clause is checked by a script in the package, not by reading.

- P1. Parity matrix. `parity/matrix.tsv` has one row per component in the research inventory. Each row carries a status: `implemented`, `mapped` (a Pi built-in owns the behavior), `deviation` (Pi forbids the exact behavior; the row names the rule), or `unmet` (needs a Cursor service or runtime Pi lacks; the row names it). `npm run check:parity` fails when an inventory row is missing, when an `implemented` or `mapped` row names no test, or when a named test does not exist.
- P2. Component tests. Every `implemented` row has a test that renders the real component or runs the real handler and asserts literal strings, glyphs, and SGR colors from the research.
- P3. Screen parity. The captured Cursor screens (empty resume pager at 110x36 and 60x20, rule wizard input, rule wizard scope) are reproduced in real `pi` under tmux. Plain text diff is empty after one documented normalization (the workspace path), and the captured SGR runs for the pager title and wizard heading match.
- P4. Live smoke. `pi -e extensions/pi-cursor-cli` in tmux, driven by a scripted local provider registered by a test-only extension, shows the header, composer, footer, a tool call from each built-in tool, an approval accepted and one rejected with a reason, a Shift+Tab mode switch, and a todo update. Each state is captured and asserted.
- P5. Documentation conformance. `npm run check:docs` lists every Pi API member the extension calls and fails when one is absent from the installed 0.87.1 docs or exported declarations, or when source imports a `dist/` deep path.
- P6. `npm run typecheck`, `npm test`, and coverage at 80% lines and branches pass, wired into the root `make verify`.

## Scope

About 55 units in 9 families. Rough size is 10k to 15k lines with tests.

| Family | Units | Examples |
|---|---|---|
| Foundations | 5 | package, palette and tint mixing, pager primitives, themes, harness |
| Chat chrome | 8 | header, composer, footer, working status, toasts, notifications, title |
| Transcript | 8 | Cursor tool UIs for read, bash, edit, write, grep, find, ls; thinking label |
| Cursor tools | 8 | todos, ask question, switch mode, create plan, delete, web fetch, task, goal, background shell |
| Decisions and modes | 7 | approval surface, allowlist, Run Everything, Auto-review, plan/ask/debug modes, confirm overlay, trust |
| Commands | 6 groups | about 45 ids and their aliases, /help, custom commands, skills, per-model commands |
| Pagers | 12 | resume list, config, context, copy, rewind, tasks, job log, usage, rules, commands, skills, review |
| Startup and wizards | 4 | trust dialog, approval dialog, generate-rule wizard, flags |
| Notifications | 2 | OSC 9/777/99/BEL with tmux passthrough, focus gating |

## Constraints found while grounding

- Pi built-in commands run before extension commands with the same name (`interactive-mode.js` onSubmit). `/model /resume /fork /compact /copy /name /new /quit /logout /settings /debug` stay Pi's. Cursor's `/debug` mode toggle collides with Pi's `/debug` diagnostics.
- `registerShortcut` skips reserved keys (`runner.js` RESERVED list): shift+tab, ctrl+l, ctrl+o, ctrl+t, ctrl+g, ctrl+c, ctrl+d, escape, alt+enter, ctrl+p. Shift+Tab mode cycling lives in the CustomEditor, which the docs say owns the keys it handles.
- The theme schema rejects custom color names. Cursor-only tokens (decision `#A78BFA`, debug `#E34671`, pager accent `#F4E7A1`/`#7A5A00`, composer and message tints, diff row backgrounds) live in a code palette chosen from the active theme.
- Pi owns transcript rendering for user, assistant, thinking, and compaction messages. Extensions control only theme colors, Markdown transforms, and the hidden-thinking label there.
- Cross-row tool grouping (merged read/search, zen groups, task groups) has no documented hook.
- Cursor services have no local equivalent: Cursor login, cloud agents, team, Bedrock, plan usage, plugin marketplace, updater, prompt-quality dashboard, AI attribution, semantic search, lints, web search, image generation, MCP, sandbox runtime, persistent sessions, Statsig tips.

## Mechanism map

| Capability | Pi mechanism |
|---|---|
| Cursor palettes for Pi roles, Markdown, diff, syntax | Theme files `cursor-dark`, `cursor-light` in the package |
| Light/dark detection | Pi automatic theme setting `cursor-light/cursor-dark` |
| Header, composer, footer, working status, toasts | Extension `ctx.ui` setHeader, setEditorComponent, setFooter, setWorkingIndicator, setWorkingMessage, setWidget |
| Tool UIs for built-in tools | Extension `registerTool` with the same names, delegating to `create*ToolDefinition` |
| Cursor tools Pi lacks | Extension `registerTool` |
| Approvals, allowlist, Run Everything | Extension `tool_call` handler |
| Modes | Extension `setActiveTools` plus `before_agent_start` prompt sections |
| Cursor rules `.cursor/rules/*.mdc` | Extension `before_agent_start` prompt sections |
| Custom commands `.cursor/commands`, `.claude/commands` | Prompt templates through `resources_discover` |
| Cursor and Claude skill folders | Skills through `resources_discover` |
| `/commit` | Prompt template in the package |
| Coded commands, pagers, wizards | Extension `registerCommand` plus `ctx.ui.custom` |
| Workspace trust | Extension `project_trust` (personal and CLI extensions only) |
| `--plan`, `--mode`, `--yolo`, `--auto-review` | Extension `registerFlag` |
| Notifications | Extension `agent_settled` plus terminal escapes, as in the official `notify.ts` example |
| Distribution | Pi package manifest |

## Rigor

High. The package replaces the editor, footer, header, and every built-in tool renderer. It adds a gate that can block tool calls, and model tools that change agent behavior. The user also made strict documentation adherence a hard requirement. Gates are P1 to P6, a cross-model review of the trail, and a judge pass on every delegated unit.
