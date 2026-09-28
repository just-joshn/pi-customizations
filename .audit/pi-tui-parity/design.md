# pi-reference-cli design

Refines `framing.md` after API grounding against installed pi 0.87.1. Every API named here was
confirmed in `dist/core/extensions/types.d.ts`, `dist/index.d.ts`, or `pi-tui/dist/index.d.ts`.

## Verified API ground

- `ctx.ui.setHeader`, `setFooter` (with `ReadonlyFooterDataProvider.getGitBranch`),
  `setWorkingIndicator`, `setWorkingMessage`, `setWidget`, `setStatus`, `setTitle`,
  `setEditorComponent`, `custom<T>` all exist on the extension UI context.
- `CustomEditor` is exported from `@earendil-works/pi-coding-agent`
  (`modes/interactive/components/custom-editor`); `modal-editor.ts` shows the official
  subclass pattern (`handleInput` + `render` overrides).
- `Theme` exposes `name`, `fg(color)`, `bg(color)`, `getColorMode()`. Theme-name-keyed code
  palette is therefore possible (constraint: schema has exactly 56 fixed roles).
- `pi-tui` exports `Box Text Markdown Editor SelectList ScrollView Loader Spacer HStack VStack`,
  `fuzzyFilter fuzzyMatch` (palette filtering parity), `TuiAltScreen` (unified-list alt-screen
  parity), `hyperlink` (OSC 8), `visibleWidth truncateToWidth sliceByColumn wrapTextWithAnsi`.
- Built-in tools are constructible via `createBashTool createEditTool createReadTool
  createWriteTool` for delegate-style renderer registration.
- Reserved keybindings (runner.js) block extension shortcuts on app actions; Shift+Tab mode
  cycling therefore lives inside the CustomEditor subclass.
- Pi built-in slash commands resolve before extension commands; colliding Reference ids stay pi's.

## Package layout

```
extensions/pi-reference-cli/
├── package.json          # pi: { extensions: [./src/index.ts], themes: [./themes/*.json], prompts: [./prompts/*.md] }
├── tsconfig.json
├── src/
│   ├── index.ts              # entry; registers modules; guards TUI-only work with ctx.mode
│   ├── palette.ts            # Reference-only tokens keyed by theme name; tint mixing formula
│   ├── constants.ts          # SK/WE/Ok/a6/WT/U5/qg/CN/UM/rY/DN/dd/V2/p9; spinner frames; verbs
│   ├── format.ts             # cwd-relative left-truncate; Today/Yesterday/N days ago; 1.23k tokens
│   ├── chrome/header.ts      # AppHeader parity: bold "Reference Agent", dim version, tip line
│   ├── chrome/footer.ts      # rows B+C: model · params · context% · files edited · cwd · branch
│   ├── chrome/working.ts     # braille frames 250ms; Thinking/Summarizing/verb labels; token count
│   ├── editor/reference-editor.ts  # CustomEditor subclass: glyph, placeholder, half-block, modes, vim
│   ├── tools/                # read bash edit write renderers (delegate to create*Tool) + todos tool
│   ├── decisions/gate.ts     # tool_call handler: approval, allowlist, run-everything state
│   ├── decisions/surface.ts  # DecisionSurface component: exact titles, options, keys
│   ├── commands/registry.ts  # full Reference command table with pi mapping status per id
│   ├── commands/register.ts  # registers feasible ids; Reference help output; ephemeral print styling
│   ├── pagers/               # context (segmented bar), usage, jobs, copy, resume unified-list
│   ├── notify/osc.ts         # OSC 9 / 777 / 99 / BEL, tmux DCS passthrough, focus gating
│   └── wizard/rule.ts        # generate-rule visuals; writes AGENTS.md (pi rule mechanism)
├── themes/reference-dark.json   # Reference colors mapped onto pi's 56 fixed roles
├── themes/reference-light.json
├── prompts/commit.md         # /commit parity prompt template
├── test/                     # node --import tsx --test; c8 80/80/80 (house style)
├── scripts/check-parity.mjs  # P1 gate with negative control
├── scripts/check-docs.mjs    # P5 gate with negative control
├── scripts/tmux-smoke.mjs    # P3/P4 harness: real pi, scripted provider, capture + assert
└── docs/parity.md            # claim table per inventory row; unmet contracts
```

## Unit sequence (each ends in its check before the next starts)

| # | Unit | Check |
|---|---|---|
| U1 | Scaffold: package.json, tsconfig, themes, palette, constants, format, test harness | tsc green; theme JSONs validate against pi schema; palette tests assert exact hex + mixing math |
| U2 | Chrome: header, footer, working indicator | rendered lines assert literal strings/glyphs from research with real Theme |
| U3 | Tool renderers: read, bash, edit, write (delegate) | renderCall/renderResult assert verbs, $ glyph, exit/duration, +N −M, diff ≤12 lines, path ≤50 |
| U4 | Todos tool (Reference TodosUI ✔◐○) | row glyphs, order (completed→in progress→pending), colors asserted |
| U5 | Decision gate + surface | approve proceeds, reject blocks with reason; titles/options/keys exact per operation |
| U6 | Editor: SkinStyleEditor extends CustomEditor | glyph/placeholder/half-block/vim renders; shift+tab cycle; ctrl+o; reserved-key passthrough |
| U7 | Commands: registry data + registration + help | exact ids/aliases/descriptions; collisions mapped to pi; help output matches print styling |
| U8 | Pagers: context, usage, jobs, copy, resume | bar math, footer strings ("Esc to close"), empty states asserted |
| U9 | Notifications (OSC family + focus gating) | per-terminal escape strings + tmux DCS wrap asserted |
| U10 | /rule wizard → AGENTS.md | step sequence, placeholders, scope picker; file written with front-matter-style section |
| U11 | Parity matrix gate (P1) | check-parity red on a missing row (negative control), green when complete |
| U12 | Docs conformance gate (P5) | check-docs red on an unknown API member (negative control), green on real source |
| U13 | tmux smoke (P3, P4) | real pi renders header/composer/footer/tool rows/approval; frames captured and asserted |
| U14 | docs/parity.md + README + Makefile wiring | make verify green end to end |

Delegated units get a judge pass (fresh subagent reviews the diff against the inventory rows).

## Theme role mapping (dark; light mirrors with light values)

| pi role | Reference source |
|---|---|
| text | #E5E7EB (hn dark) |
| muted | #9C9C9E |
| dim | #6E6E70 (between #9C9C9E and border grays; keeps legibility) |
| accent | #F4E7A1 (r3, dark pager titles) |
| mdHeading, mdLink | #93C5FD |
| mdCode | #A8B5E6 |
| mdHr, mdQuoteBorder | #3E3E40 |
| toolDiffAdded / Removed / Context | #3fb950 / #f85149 / #9C9C9E |
| success / error / warning | #58D68D / #f85149 / #F4E7A1 |
| userMessageBg | #242428 (Reference ANSI256 fallback 235 for the .82 tint mix) |
| toolPendingBg / toolSuccessBg / toolErrorBg | #151515-mixed neutrals per Reference composer fallback 233 |

Code palette (not expressible in schema): r3 #F4E7A1, Ik #7A5A00, aQ #A78BFA, debug #E34671,
diff row bgs (#2b3f2b/#402626 dark, #D0E8C5/#F7D1BA light), inline change bgs, composer tint
#505050@0.95 (fallback #151515), user tints, /btw bar grey. Chosen by active theme name.

## Harness (built in U1, used by U13)

`scripts/tmux-smoke.mjs` starts an isolated tmux server (fresh HOME + workspace, pattern after
the research `capture-screen.sh`), launches real `pi` with `--extension` plus a test-only
provider extension that scripts model responses, drives the keyboard, polls for expected text,
and saves text + ANSI captures. Assertions compare plain text after one documented
normalization (workspace path). control-cli skill supplies the harness conventions.

## Deviation ledger (matrix rows marked deviation, with the rule that forbids parity)

- Ink/Yoga/cell compositor/Static internals: pi owns the renderer; tui.md forbids a second one.
- Reserved keys via registerShortcut: runner.js skips them; handled in CustomEditor instead.
- Pi built-in command ids: interactive-mode resolves them first; matrix marks them `mapped`.
- Theme schema custom roles: additionalProperties false; Reference-only tokens live in palette.ts.
- Reference backend services (login, cloud, teams, bedrock, usage billing, marketplace, updater,
  Statsig tips, semantic search, lints, image generation): no local equivalent; rows `unmet`.
