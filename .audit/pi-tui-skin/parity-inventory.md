# pi-tui-skin parity inventory

Every difference between this skin and the installed `reference-agent`, the evidence
it was measured from, and what happened to it. Evidence is one of:

- **frame** — a committed capture under `extensions/pi-tui-skin/reference/reference-agent-2026.09.28-64d2043/`,
  taken with `tmux capture-pane` from the installed build `2026.09.28-64d2043`.
- **pixel** — a measurement off the user's side-by-side recording, decoded with
  `ffmpeg` to raw RGB. File names and timestamps are given so the measurement can
  be repeated.
- **unit** — a named test in `extensions/pi-tui-skin/test/`.

The harness that turns these into a pass or a fail is
`extensions/pi-tui-skin/scripts/compare-reference.mjs`. It derives its
expectations from the reference frame rather than from constants in the script,
so a `reference-agent` upgrade moves the target instead of silently passing.

## Resolved

| # | Surface | Reference | Was | Now | Evidence | Mechanism |
|---|---|---|---|---|---|---|
| 1 | Banner rows | `  Reference Agent`, `  v<build>`, `  Tip: <one of seven>` | `> agent`, `Pi Coding Agent`, `<cwd>` | `  Pi Coding Agent`, `  v<pi version>`, `  Tip: <one of five>` | frame `01-idle.txt` rows 0-2 | `ctx.ui.setHeader` |
| 2 | Banner indent | two columns on all three rows | none | two columns | frame `01-idle.txt` | `setHeader` |
| 3 | Footer row count at rest | two rows | three rows | two rows | frame `01-idle.txt` rows 6-7 | `ctx.ui.setFooter` |
| 4 | Footer mode row | absent for the default mode, present as `  Plan (shift+tab to cycle)` after a change | always present, carrying the thinking level | present only once pi's thinking level leaves its session-start value | pixels from `Screen Recording 2026-09-28 at 7.31.58 PM.mov` at 00:00, right pane; frame `10-mode-plan.txt` | `setFooter` |
| 5 | Footer model row | `Auto`, or `Auto · 8%` once context is in use | `DeepSeek V4.1 Flash · 0%` at rest | `<model>`, with ` · <n>%` only above zero | frame `01-idle.txt`; pixels from the recording at 00:00 and 00:25, right pane | `setFooter` |
| 6 | Footer edit counter | no such row | ` · 1 file edited` appended to the model row | removed | frame `01-idle.txt` row 6 | `setFooter`, store field deleted |
| 7 | Composer text column | `  → Plan, search, build anything`, glyph at column 2, text at column 4 | glyph at column 2 on the placeholder row only; typed text moved to column 2 and the glyph vanished | `paddingX` 4 with Pi's leading padding repainted as `  → ` | frame `02-typed.txt`; pixels from the recording, left pane | `ctx.ui.setEditorComponent` |
| 8 | User-message band fill | `#242428` | `#1b1b22`, i.e. darker than the terminal background where the reference is lighter | `#242428` | pixel run of `47,48,59` in `t003.png` at y=360, right pane, against the `48;2;36;36;40` SGR in `transcript/replay.ansi.txt` line 13 | theme role `userMessageBg` |
| 9 | Working spinner after a theme switch | n/a, the reference has one theme | frames baked tui-skin's `success` at install time and kept it after `/settings` chose another theme | re-derived from the live theme proxy once per editor render | unit `test/editor.test.ts`; live scenario `theme-switch-spinner` | `ctx.ui.setWorkingIndicator` plus the editor's render pass |
| 10 | `theme-switch` scenario | n/a, harness | asserted the substring `tui-skin`, which the temp workspace path `pi-tui-skin-ws-…` satisfied, so the step passed without opening a picker | drives `/settings` and asserts the Theme row | live scenario `theme-switch` | harness fix in `scripts/tmux-smoke.mjs` |

## Named gaps

These are real differences that this skin does not close. Each is reported by the
harness rather than deleted from it.

| # | Surface | Reference | Why it is open | Mechanism |
|---|---|---|---|---|
| G1 | Footer location row | `<path> · <branch> · #<PR>` | Pi's footer data provider exposes the git branch only. No documented API exposes a pull-request number, and shelling out from a render path is not a presentation mechanism. Declared to the harness with `--known "location PR segment"`. | none |
| G2 | Footer model row, right-aligned | `Run Everything` on the model row | A Run Everything toggle is a Reference feature with no pi counterpart to report. | none |
| G3 | User-message band margin | one-column left margin: ` margin + 108 columns + ` in a 110-column pane | `UserMessageComponent` renders a `Box` at the full transcript width and exposes no outer margin. `outputPad` changes the padding inside the band, which widens the fill instead of narrowing it. `registerMessageRenderer` is refused by this package's own `check-skin-boundaries.mjs`, because replacing a message renderer is behavior-adjacent. | none |
| G4 | Tool-row grouping | consecutive calls collapse under one bold heading, `Read, grepped 1 file, 1 grep`, with the members indented beneath | Pi renders one transcript entry per tool call and exposes no hook that sees sibling calls in the same assistant message. Reproducing the heading would need the first call to render its siblings, which breaks on scrollback and on session replay. | none |
| G5 | Tool-row hidden-item summary | `    … 3 earlier items hidden` | Follows from G4: the count is a property of the group, not of one call. | none |
| G6 | Stop hint while running | `ctrl+c to stop` | Pi aborts with `escape`; `ctrl+c` clears the editor and exits (docs/keybindings.md, `app.interrupt` and `app.clear`). Printing `ctrl+c to stop` would tell the user to press a key that does not stop the agent, so the hint stays `esc to stop`. | none |
| G7 | Banner title | `Reference Agent` | The banner sits above pi's transcript. Per the operator's decision it keeps pi's identity and adopts the reference's shape. | n/a |
| G8 | Placeholder at 24 columns | wraps: `  → Plan, search,` then `    build anything` in a 24x8 pane (frame `16-tiny.txt`) | The skin builds the input row and truncates it with an ellipsis, so it renders `  → Plan, search, bui…` on one line. The row is skin-owned, so wrapping is reachable, but the row's height then depends on width and Pi's editor reference arithmetic assumes one row per input line. Left open rather than risking the reference column. | `setEditorComponent` |

## Harness

- `scripts/capture-reference.mjs` re-captures the baseline from the installed
  `reference-agent` for the states reachable with keystrokes alone, so no model
  request is spent. `--check` diffs a fresh capture against the committed one.
- `reference/reference-agent-2026.09.28-64d2043/transcript/` holds a replay of a real
  chat. Replaying history renders assistant prose and tool rows without spending
  a request, which is the only free source of that layout.
- `scripts/compare-reference.mjs` reduces both frames to a skeleton of classified
  rows and compares them in order.
- The baseline was re-captured for this work, not edited. The previous two files
  held a strict subset of the same frame: re-running the capture reproduces the
  band, the input row, the model row, and the location row byte for byte. The
  only lines that differ between runs are the rotating `Tip:` row and the
  location row, whose value follows the working directory.
