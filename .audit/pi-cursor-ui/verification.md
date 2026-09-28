# pi-cursor-ui: verification trail

Every result below is from a command that ran on this machine against the real
artifact. Captures live under `extensions/pi-cursor-ui/artifacts/<scenario>/`.

## Offline gates

| Gate | Command | Result |
|---|---|---|
| Type check | `bun run typecheck` | exit 0, no diagnostics |
| Unit tests | `bun run test:coverage` | 11 files, 134 passed, 1 skipped |
| Coverage | same run | statements 91.26, branches 86.77, functions 83.33, lines 92.54, thresholds 80 |
| Behavior boundary | `node scripts/check-skin-boundaries.mjs` | `violations: 0 in 22 source files` |
| Lint self-test | `node scripts/check-skin-boundaries.mjs --self-test` | `self-test: 4 fixtures passed` |
| Prompt parity | `node scripts/check-prompt-parity.mjs` | `parity: system prompt, 4 tool definitions, and reply identical (read, bash, edit, write)` |
| Theme validation | `test/theme.test.ts` against the installed `theme-schema.json` | every required role present, every `vars` reference resolves |
| Tool execution equivalence | `test/execution-equivalence.test.ts` | read, bash, edit, write, grep, find, ls match the official definition on content, details, and thrown message; metadata identical for all eight; powershell skipped on darwin |
| Vitest conventions | `node extensions/scripts/check-vitest-conventions.mjs` | 0 violations |
| Repository lint | `bun run ci` | 192 files checked, clean with `--error-on-warnings` |
| Pi mechanisms | `node scripts/check-pi-mechanisms.mjs` | 7 packages checked, exit 0 |
| Make target | `make verify-cursor-ui` | check:skin, typecheck, test:coverage all exit 0 |

## Live TUI matrix

`node scripts/tmux-smoke.mjs --all` runs real `pi` in tmux with a scripted local
provider. 21 scenarios, 49 captures, 0 failures. Each capture is plain text plus
an ANSI companion.

| Scenario | What it proves |
|---|---|
| `idle` | header, editor box, placeholder, and footer render at boot |
| `prompt` | a submitted prompt reaches the provider and the reply lands |
| `stream` | the frame during streaming holds `SLOW REPLY STREAMING` and not the final text, so the capture is genuinely mid-stream |
| `cancel` | Escape returns the editor to the idle placeholder |
| `steer` | text submitted while streaming queues `Steering: steer now` |
| `followup` | alt+enter queues `Follow-up: follow up` |
| `thinking` | shift+tab writes `Thinking level: high` and the footer dot changes |
| `slash` | `/` opens the command menu `(1/25)` |
| `files` | `@note` completes to `note.txt` |
| `shell` | `!echo CURSOR_UI_SHELL_OK` prints its output |
| `shell-nocontext` | `!!echo CURSOR_UI_SHELL_NC_OK` prints its output |
| `tools` | one scripted turn per built-in, seven rows render as `◇ Read`, `◇ Bash`, `◇ Write`, `◇ Edit`, `◇ Search`, `◇ Find`, `◇ List` |
| `widget` | `● Running sleep 4 && echo SLOW_MARKER_LATE` is visible only while the tool runs |
| `expand` | ctrl+o reveals the real write, diff, grep, find, and ls output |
| `resize` | 72x22 then 140x44 keep the frame intact and truncate the cwd |
| `reload` | `/reload` re-installs header, editor, and footer |
| `fullscreen` | `--tui-mode fullscreen` renders the skin |
| `package-load` | `pi -e extensions/pi-cursor-ui` loads the extension and the theme through the package manifest |
| `print-mode` | non-TUI print mode loads the extension and replies |
| `json-mode` | non-TUI json mode loads the extension and emits `agent_end` |
| `rpc-mode` | non-TUI rpc mode answers a `prompt` command |

Windows are sized manually and the tmux server runs with
`set -g extended-keys on` and `set -g extended-keys-format csi-u`, which is what
makes alt+enter reach pi as a follow-up.

## Measured palette checks

`artifacts/idle/01-idle.ansi.txt` contains `38;2;62;208;122` on the editor
border lines. That is `#3ed07a`, the theme's `success`, so the idle border is
green. `artifacts/widget/02-widget.ansi.txt` contains `38;2;108;91;157`. That is
`#6c5b9d`, the theme's `borderAccent`, which is exactly the busy editor border
measured from the recording at `rgb(108,91,157)`.

## The defect that mattered

The first implementation registered same-name overrides for all eight built-ins.
`check-prompt-parity` showed the consequence.

```
without the skin: read,bash,edit,write
with the skin:    read,bash,edit,write,powershell,grep,find,ls
```

The system prompt's tool list gained four tools and the rules section lost
`Use bash for file operations like ls, rg, find`. Pi activates every registered
extension tool in `AgentSession._refreshToolRegistry`, and the factory cannot
read `pi.getActiveTools()` because actions throw before the runtime binds. The
fix registers the four default-active built-ins and gates the other four behind
`PI_CURSOR_UI_TOOL_OVERRIDES`. The parity check now passes.

## Not verified

- Mid-session theme switching. The settings dialog needs interactive
  navigation, so no scenario drives it. Components recompute themed strings on
  every render and Pi invalidates every mounted component on a theme change.
  The one exception is the working-indicator frame set, which Pi colors at
  install time and does not re-apply.
- PowerShell tool rows. `pwsh` is not installed on this machine, so
  `test/execution-equivalence.test.ts` skips it and no live frame exercises it.
  Its renderer shares `render-shell.ts` with bash, which is covered.
- `src/index.ts` function coverage is 0. Its three functions are exercised only
  through a real pi process, which the tmux matrix does, but the v8 report does
  not see it. Global thresholds still pass.
- The eight `execute` delegation wrappers inside `register-tool-renderers.ts`
  run only in a live session. Equivalence is proven for the underlying
  definitions in `test/execution-equivalence.test.ts`.
