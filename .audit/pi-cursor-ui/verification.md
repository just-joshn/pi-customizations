# pi-cursor-ui: verification trail

Every result below is from a command that ran on this machine against the real
artifact. Captures live under `extensions/pi-cursor-ui/artifacts/<scenario>/`.

## Offline gates

| Gate | Command | Result |
|---|---|---|
| Sweep | `node scripts/ui-sweep.mjs` | `findings: 0` on two consecutive full runs |
| Type check | `bun run typecheck` | exit 0, no diagnostics |
| Unit tests | `bun run test:coverage` | 13 files, 2313 passed, 2 expected fail, 1 skipped |
| Coverage | same run | statements 92.3, branches 93.28, functions 84, lines 92.43, thresholds 80 |
| Behavior boundary | `node scripts/check-skin-boundaries.mjs` | `violations: 0 in 22 source files` |
| Lint self-test | `node scripts/check-skin-boundaries.mjs --self-test` | `self-test: 4 fixtures passed` |
| Frame invariant self-test | `node scripts/lib/frame-invariants.mjs --self-test` | `9/9 passed (visibleWidth source: pi-tui)` |
| Prompt parity | `node scripts/check-prompt-parity.mjs` | `parity: system prompt, 4 tool definitions, and reply identical (read, bash, edit, write)` |
| Renderer width fuzz | `test/renderer-fuzz.test.ts` | 42899 renderer x width x fixture combinations, no overflow above 1 column |
| Theme roles | `test/theme-roles.test.ts` | every role read in `src/` exists in the theme JSON |
| Theme validation | `test/theme.test.ts` against the installed `theme-schema.json` | every required role present, every `vars` reference resolves |
| Tool execution equivalence | `test/execution-equivalence.test.ts` | read, bash, edit, write, grep, find, ls match the official definition on content, details, and thrown message; metadata identical for all eight; powershell skipped on darwin; the configured shell path and command prefix reach the delegated bash call |
| Settings round trip | `/tmp/cursor-ui-repro/ab-run.mjs` (live A/B) | `pi` alone and `pi` with the skin both print `PREFIX=[SET]` and each invoke the configured shell once |
| Vitest conventions | `node extensions/scripts/check-vitest-conventions.mjs` | 0 violations |
| Repository lint | `bun run ci` | 196 files checked, clean with `--error-on-warnings` |
| Pi mechanisms | `node scripts/check-pi-mechanisms.mjs` | 7 packages checked, exit 0 |
| Make target | `make verify-cursor-ui` | check:skin, typecheck, test:coverage all exit 0 |

## Live TUI matrix

`node scripts/tmux-smoke.mjs --all` runs real `pi` in tmux with a scripted local
provider. 44 scenarios, 123 passing steps, 0 failures, and
`invariants: 0 findings, 1005 passed, 195 skipped` on a run that followed 20
fuzz sessions. Each capture is plain text plus an ANSI companion, and every
capture is checked for a crash marker, a lost footer, an orphaned tool row, a
leaked escape, a duplicated header, a right-aligned hint that drifted, and an
uncolored editor rule.

`node scripts/tmux-smoke.mjs --fuzz 20 --seed 1` runs 20 seeded sessions of 10
to 25 actions at five terminal sizes, capturing and checking after every
action. It reports `invariants: 0 findings`.

Pacing matters: before the provider paced its turns, all eight captures in the
`tools` scenario were byte-identical, so the per-row assertions proved nothing
about the in-flight layout. `md5 -q artifacts/tools/0{2..9}-*.txt` now returns
eight distinct plain captures, each rejecting the row that comes next.

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
| `tools` | one scripted turn per built-in, seven rows render as `◇ Read`, `◇ Bash`, `◇ Write`, `◇ Edit`, `◇ Search`, `◇ Find`, `◇ List`, one added per step |
| `widget` | `● Running sleep 4 && echo SLOW_MARKER_LATE` is visible only while the tool runs |
| `cancel` | Escape stops the stream: the cancelled frame rejects `CURSOR_UI_REPLY_OK` and the stop hint |
| `abort-tool` | the running border shows `esc to stop`, and the aborted frame returns to the idle green with no activity row |
| `error-tool` | the row is error red (`38;2;224;108;117`) and the agent recovers |
| `parallel-tools` | two calls in one turn render two rows |
| `long-output` | a 2000-line result collapses to one row, expands with ctrl+o, and stays inside the pane |
| `expand` | ctrl+o reveals the real write, diff, grep, find, and ls output |
| `resize` | 72x22 then 140x44 keep the frame intact and truncate the cwd |
| `resize-storm` | five sizes in a row, including while a reply streams |
| `tiny` | 24x8 keeps the footer and placeholder on screen |
| `narrow` | 40x12 renders both a tool row and the footer |
| `colossus` | 200x60 renders without stretching a row |
| `unicode` | a CJK and emoji file read keeps rows aligned |
| `journey` | read, edit, grep, and bash across four turns, with the edited-file counter |
| `reload` | `/reload` re-installs header, editor, and footer |
| `reload-mid-turn` | `/reload` during a running tool leaves one header, one footer, and no stale activity row |
| `reload-twice` | two reloads leave exactly one header |
| `quit` | two ctrl+c presses exit `PI-EXITED-0` with no crash marker, exercising uninstall |
| `model-switch`, `theme-switch`, `compact` | each picker or command leaves the frame intact |
| `at-accept`, `history-recall` | completion accepts into the editor, and Up recalls the last prompt |
| `no-color`, `term-256` | the frame renders under `NO_COLOR=1` and `TERM=tmux-256color` with no escape leak |
| `non-git`, `outside-home` | no broken branch label, no broken home shortening |
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

## The bug sweep

A verify-and-fix loop ran three finders against the first revision: the live
matrix above, the width fuzz, and a proof-bound adversarial review of every
source file. It found six user-visible defects. Each has a failing test in
commit `609e11d3` and its fix in the next commit, and the sweep that followed
reported zero findings twice in a row.

| Defect | Symptom | Root cause |
|---|---|---|
| Shell settings ignored | A user with `shellPath` or `shellCommandPrefix` saw the model run the default shell with no bootstrap prefix | The wrapper built its own definition with no options, and Pi replaces a same-name definition wholesale |
| Image resize ignored | `images.autoResize` never reached the read tool | Same wrapper choice, identical call path |
| Unescaped output | A file or a progress bar could clear or overwrite rows with ANSI, carriage returns, or control characters | Expanded results passed raw text straight to `Text` |
| False error row | A successful command that printed `Error:` showed as a failure and hid its expansion | A text-prefix heuristic stood in for Pi's `isError` flag |
| Write row count | A one-line file with a trailing newline read `(2 lines)`, and `(1 lines)` for one line | The count split on newlines and ignored pluralization |
| Unescaped arguments | A carriage return in a path or command blanked the call row | Call rows passed raw argument text to `TruncatedText` |
| Lost scroll affordance | While running, the editor replaced Pi's centered `↓ N more` label | The override replaced Pi's border instead of adding to it |

The adversarial review also proved two non-defects before the fix stage. Pi's
owned `read` renderer overflows a 1-column terminal with a 2-cell grapheme
exactly like this skin does, so the case is documented with `test.fails` rather
than papered over. Pi ignores `NO_COLOR=1` on this build, so the `no-color`
scenario asserts a rendering frame with no escape leak, not a colorless one.

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

- Resume with `-c`. The driver passes `--no-session`, and session persistence
  is out of scope for a presentation-only skin. `/reload` covers the install
  path that a resumed session re-runs.
- Mid-session theme switching. The settings dialog needs interactive
  navigation, so no scenario drives it. Components recompute themed strings on
  every render and Pi invalidates every mounted component on a theme change.
  The one exception is the working-indicator frame set, which Pi colors at
  install time and does not re-apply. The `theme-switch` scenario opens and
  closes the picker without selecting a theme.
- PowerShell tool rows. `pwsh` is not installed on this machine, so
  `test/execution-equivalence.test.ts` skips it and no live frame exercises it.
  Its renderer shares `render-shell.ts` with bash, which is covered.
- A 1-column terminal with a 2-cell grapheme. Pi's `Text` cannot fit it and
  Pi's own renderer overflows the same way, so the case is pinned by two
  `test.fails` cases and one test that records the exact 2-cell line.
- `src/index.ts` function coverage is 0. Its three functions are exercised only
  through a real pi process, which the tmux matrix does, but the v8 report does
  not see it. Global thresholds still pass.
- The eight `execute` delegation wrappers inside `register-tool-renderers.ts`
  run only in a live session. Equivalence is proven for the underlying
  definitions in `test/execution-equivalence.test.ts`, and the settings path is
  proven both there and by a live A/B.
