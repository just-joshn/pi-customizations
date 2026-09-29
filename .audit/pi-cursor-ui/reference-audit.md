# pi-cursor-ui: reference audit against the installed Cursor Agent CLI

Reference: `cursor-agent` version `2026.09.28-64d2043` at
`~/.local/bin/cursor-agent`, captured live on this machine. The original
implementation was built from `~/Desktop/cursor-cli.mov`; this audit re-checked
it against the installed build, which is a different and more recent design.

Rerun any row below with the command in its evidence column. Raw captures live in
`extensions/pi-cursor-ui/reference/`, and `node scripts/compare-reference.mjs`
asserts the skin still matches them.

## Why the installed CLI replaced the video as the reference

The two disagree on the composer itself, and the installed build is the product
that actually ships today.

| Element | Video | Installed CLI |
|---|---|---|
| Composer frame | four-sided box, `┌ ┐ └ ┘ │`, square corners | filled band, a `▄` row above and a `▀` row below, no sides |
| Mode line | `◉ Plan (shift+tab to cycle)`, green, flush left | `  Plan (shift+tab to cycle)`, per-mode color, two-column indent, no glyph |
| Footer | mode line, model line, `/ commands · @ files · ! shell` | mode line, status row, location row |
| Location | `~/path · main` in the header | `  ~/path · branch`, third footer row |
| Header | `> agent` / `Cursor Agent` / `~/path · main` | splash banner with a version and a rotating tip |

Decisions taken from that table:

1. The composer is a half-block band, not a box.
2. The footer is the three rows the CLI draws, indented two columns.
3. The branch and the directory are the footer's location row, not the header.
4. The `/ commands · @ files · ! shell` hints row is gone. The CLI has no such
   row; it shows those keys behind `?`. This is the one deliberate affordance
   loss in the change, and it is isolated to `src/ui/footer.ts` if it should
   come back.
5. The placeholder is the CLI's exact string, `Plan, search, build anything`.

## Findings and fixes

| # | Element | Reference | Before | Now | Evidence |
|---|---|---|---|---|---|
| 1 | Composer frame | ` ▄▄▄…` / `  → …` / ` ▀▀▀…` | two `─` rules | half-block band, 1-column margin | `scripts/compare-reference.mjs` |
| 2 | Band color | fill `#151515`, drawn as a foreground | `─` rule in the phase color | `borderMuted` = `#151515` | `artifacts/sweep/08-live-matrix.log` |
| 3 | Band in shell mode | the CLI accents its input prefix | violet `borderAccent` | Pi's own `bashMode` accent | `test/editor.test.ts` |
| 4 | Text column | column 2 | column 0 | 2, plus the host's `editorPaddingX` | `test/editor.test.ts` |
| 5 | Mode line | `  Plan (shift+tab to cycle)` | `◉ Medium` plus a right-aligned `shift+tab to cycle` | one left-aligned line, inline parentheses | `scripts/lib/frame-invariants.mjs` |
| 6 | Footer indent | two columns on every row | flush left | two columns | `scripts/compare-reference.mjs` |
| 7 | Location row | `  ~/cwd · branch` | branch right-aligned on the model row | footer row C | `test/chrome.test.ts` |
| 8 | Status row | model, then context, then edited count | same | same, now indented | `test/renderer-fuzz.test.ts` |
| 9 | Placeholder | `Plan, search, build anything` | `Ask, build, or change anything` | the reference string | `artifacts/idle/01-idle.txt` |
| 10 | Stop hint | right placeholder inside the composer, only while the input is empty | appended to the bottom rule | right-aligned on the input row | `test/editor.test.ts` |
| 11 | Hint label | `ctrl+c to stop` | `esc to stop` | `esc to stop` | see below |

Two reference behaviors are deliberately not reproduced.

- **Hint label.** The reference reads `ctrl+c to stop`. Pi cancels with Escape,
  so the skin keeps `esc to stop`. The position matches; the key does not.
- **Composer fill.** The reference fills the input row with a background color.
  Pi themes seven fixed background roles, none of which is a composer surface, so
  only the two half-block bars carry the fill. The input row sits on the terminal
  background.

## Defects found in the shipped implementation

These were live bugs, not reference mismatches.

| Defect | Symptom | Root cause |
|---|---|---|
| Pi overwrote the composer padding | the glyph was pushed right and the stop hint was truncated away at every width | Pi re-applies the `editorPaddingX` setting with `setPaddingX` after mounting the editor, discarding the constructor value. `CursorStyleEditor.setPaddingX` now folds the setting into the columns the band needs, so Pi's mouse arithmetic still matches the text column |
| The stop hint vanished on a narrow terminal | `esc to stop` disappeared entirely below 19 columns | the in-row hint had no fallback. It now falls back to the bottom band, then is dropped only when neither fits |
| Every `esc to stop` assertion could pass on an empty row | the abort scenario had no positive check | the scenario now requires the hint row and the fill color together |

## Harness changes

The live invariants encoded the old design, so they now encode the reference.

| Invariant | Change |
|---|---|
| `box-framed` | replaced by `prompt-band`: a `▄` band above the input, a `▀` band below, and a side margin on every row between them |
| `mode-line-left-aligned` | was `hint-flush-right`; the mode line is a left-aligned `  <label> (shift+tab to cycle)`, and nothing in the footer is right-aligned |
| `footer-missing` | now structural: a composer band with nothing but blanks below it is a missing footer, which holds at every pane width |
| `color-missing` | reads the band rows instead of the old rule rows |
| self-test fixtures | 15, including a working-status label inside the top band and a bare Pi transcript rule above the composer |

## Verification

Every number below is from a command run on this machine at this revision.

| Gate | Command | Result |
|---|---|---|
| Sweep | `node scripts/ui-sweep.mjs` | `findings: 0`, all 11 steps pass |
| Type check | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test:coverage` | 14 files, 2323 passed, 2 expected fail, 1 skipped |
| Coverage | same run | statements 96.43, branches 91.24, functions 96.12, lines 97.82, thresholds 80 |
| Style boundaries | `node scripts/check-skin-boundaries.mjs` | `violations: 0 in 22 source files` |
| Frame invariants | `node scripts/lib/frame-invariants.mjs --self-test` | `15/15 passed` |
| Prompt parity | `node scripts/check-prompt-parity.mjs` | system prompt, 4 tool definitions, and reply identical |
| Live matrix | `node scripts/tmux-smoke.mjs --all` | 44 scenarios, 0 failures, `invariants: 0 findings, 1122 passed` |
| Live fuzz | `node scripts/tmux-smoke.mjs --fuzz 20 --seed 1` | 20 sessions, `invariants: 0 findings` out of 1609 checks |
| Reference parity | `node scripts/compare-reference.mjs` | `failures: 0` |
| Repository lint | `bunx biome ci . --error-on-warnings` | clean |

## Not verified

- **In-session chrome.** The installed build needs a signed-in account and spent
  subscription quota to start a chat, so the reference captures cover the idle
  screen and the `/` palette only. The transcript, tool rows, and the working
  state come from the reverse-engineered bundle report that already exists at
  `~/.cursor/research/cursor-cli-2026.09.26-dd393fe/source-composer.md` and
  `source-conversation.md`, which is source-derived rather than observed.
- **The composer fill.** Pi has no theme role for it, so the input row is not
  filled. No capture can prove what the fill looks like if a role is added later.
- **`ctrl+c to stop`.** Not adopted, for the reason above.

## Open decisions

1. **The `/ commands · @ files · ! shell` hints row is gone.** The reference has
   no equivalent row. Say the word and it comes back as a fourth footer row.
2. **The header is unchanged.** The reference's header is a splash banner with a
   version and a rotating tip, shown on the empty screen only. The skin keeps
   `> agent` / `Pi Coding Agent` / `~/cwd`, which the video used.
