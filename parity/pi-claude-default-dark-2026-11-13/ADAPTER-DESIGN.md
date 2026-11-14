# Adapter design: closest Pi-native parity for pi-claude-default-dark (label: `claude`)

Nothing here was run against a live Pi. Every claim is grounded in the captures, `g4.json`, the Pi 1.5.2 docs, or the Pi 1.5.2 `dist` source. Things I inferred are marked **(inferred)**. Pi source paths are relative to `@earendil-works/pi-coding-agent/dist/`. Capture pointers are `scene@row:col` (Claude: `development/captures/claude/<scene>.ansi`; Pi: `captures/pi-claude-default-dark/`). I read the captures with a throwaway SGR dumper and wrote nothing.

## 0. Findings that shape the design

1. **Built-in renderers ignore the `theme` argument.** `tool-execution.js:233,255` passes the global `theme` into `renderCall`/`renderResult`. The built-ins (`renderers/bash.js`, `diff.js`, `render-utils.js:151`) use the imported global `theme` instead. So the design cannot swap themes. It has to restyle the ANSI lines that `next()`'s component renders.
2. **`Theme` has public tools for this.**
   - `theme.name` identifies the active theme.
   - `theme.getFgAnsi(role)` and `getBgAnsi(role)` return each role's exact escape (`theme.d.ts`).
   - `theme.style(text, {fg, bg, dim, …})` takes a pi-tui `rgbColor(...)`, so arbitrary colors and the `dim` attribute are expressible. They go through Pi's color-mode downgrade.
   - A custom theme's own `dim` attribute does not work: dim tokens are only generated for the `system` theme (`theme.js:179–204`). Dim is therefore reachable only through a renderer.
3. **No theme-change event exists.** Theme switches call `ui.invalidate()` (`theme-controller.js:116,168,206`). Tool rows re-run `renderCall`/`renderResult` on invalidate (`tool-execution.js:211–255`). So a tool renderer sees the current `theme.name` on every call.
4. **The resolver runs once per tool row.** `registerToolRenderer`'s resolver runs only when the row is created (`interactive-mode.js:1816`, `runner.js:550`). The theme check therefore goes in the returned slots, not in the resolver.
5. **The Pi theme leaves tool backgrounds at the terminal default.** `toolPendingBg`, `toolSuccessBg` and `toolErrorBg` are `""` (`themes/claude-default-dark.json`). So `Box` paints nothing, which matches Claude's tool rows. The G4 FAILs on those backgrounds are mostly comparator artifacts (§1 note).

## 1. Gap inventory

**Closure keys.** **T** is a theme value. **H1–H3** are the adapter hooks defined in §2. **✗** means not closable with public APIs.

| # | Surface | Claude value (capture) | Pi now | Closure |
|---|---|---|---|---|
| 1 | Diff line bg, removed/added | `#3d0100` / `#022800` across the row (`tool-edit@13:9`, `@15:11`) | no bg; the row is one fg color (`diff.js:113–128`) | **H1** |
| 2 | Diff intra-line segment bg | `#5c0200` / `#044700` (`tool-edit@13:31`, `@15:31`) | SGR inverse on a 1×1 block only (`diff.js:47,60,106`) | **H1**: inverse→bg. Paired lines in N×N blocks need own word-diff: partial |
| 3 | Diff gutter color | `#dc5a5a` / `#50c850` (`@13:5`, `@15:5`) | whole line in one role color, all `#f8f8f2` now (g4: toolDiffAdded 15:5, toolDiffRemoved 13:5 FAIL) | **T** `toolDiffRemoved=#dc5a5a`, `toolDiffAdded=#50c850`, plus **H1** recolors content back to `#f8f8f2` |
| 4 | Diff context line number | `#f8f8f2` + dim (`@12:5`) | plain `#f8f8f2` (g4 toolDiffContext 12:5 FAIL) | **H1** (`theme.style(…, {dim:true})`) |
| 5 | Gutter column order | `" 2 -"` (`@13:5`) | `"- 2 "` (`diff.js:113`); same 4 cells | **H1** optional permutation |
| 6 | Diff syntax tokens | Monokai: `#f92672` keyword, `#66d9ef` storage, `#a6e22e` name, `#fd971f` param, `#be84ff` number (`@12:9,22,31,42`, `@15:31`) | no token coloring at all in diffs | ✗ (see §6) |
| 7 | Failed bash output | `#ff6b80` including `Error: Exit code 1` (`tool-bash-fail-expanded@11:5`, `@12:5`) | default fg (g4 toolOutput 11:5, 12:5 FAIL) | **H2** |
| 8 | Other failed tools (edit/write text) | **(inferred)** `#ff6b80`, same tool-failure semantic. Only bash was captured. | `error` = `#ffc107` (`edit.js:67`, `write.js:126`). `error` must stay `#ffc107` for the API error (`api-error@14:2`). | **H2** behind the "inferred" flag (§4) |
| 9 | Tool-call path argument | default fg (`tool-read-expanded@10:6`, `tool-edit@10:8`) | `accent` `#b1b9f9` (`render-utils.js:151`) | **H1b** (read, edit) |
| 10 | Tool title | expanded: default+bold ✓ (`tool-bash-ok-expanded@10:2`). Collapsed summary: `#999999` (`tool-read@10:2`) | bold default (g4 toolTitle FAIL) | ✗ for the collapsed form. Different text ("Read 1 file"). The expanded form already matches. |
| 11 | Working spinner glyph + verb | `#d77757` (`working-800ms@34:0`); shimmer `#eb9f7f` (`working-1600ms@34:11`) | `#888888` (border `colorFn`, `interactive-mode.js:1932`) (g4 thinkingMedium FAIL ×2) | **H3** glyph + message color. The per-letter shimmer is ✗. |
| 12 | Prompt border | `#888888` (`idle@36:0`) | `#888888` at medium ✓. Other levels use stock okhsl. | none. Claude has no capture for other levels. |
| 13 | Bash mode `!` / border | `#fd5db1` (`shell-run@8:0`, g4 bashMode FAIL ×2) | `#5eb286` (stock `bashMode`) | **T** `bashMode=#fd5db1`. The border use in Claude's prompt is unmeasured: `shell-mode.ansi` is a transcript view. |
| 14 | Bash echo row bg | `#413c41` (`shell-run@8:0`) | boxed `$ ls` with `bashMode` rules, no bg | ✗ (`BashExecutionComponent`, `bash-execution.js:29`) |
| 15 | Markdown link | default fg, no underline (`markdown@11:59`) | `#69add0` + underline | **T** `mdLink=""` fixes color. The underline is hardcoded: residual. |
| 16 | Block-quote bar | dim default `▎` (`markdown@19:2`) | `#9da5a9` `│ ` | ✗ (dim + glyph) |
| 17 | Code fences / hr / table header | no fences; `---`; plain header (`markdown@20,26,29`) | ```` ``` ```` lines in `mdCodeBlockBorder`, `────`, bold header | ✗ (text/attrs inside `Markdown`) |
| 18 | Code-block token classes | `request`=ansi:3, `Promise`=ansi:4 (`markdown@21:24,46`) | hljs scopes differ (g4 syntaxFunction/Variable/Type FAIL ×4) | ✗ (grammar) |
| 19 | Thinking | collapsed "Thought for 1s" `#999999` (`thinking@14:2`) | italic `thinkingText` `#96a0a4` (`thinking@16`; `assistant-message.js:137`) | **T** is possible only with Claude evidence for expanded thinking, which does not exist. Italic is hardcoded: ✗. |
| 20 | Search matches | current `#f4bf75` bold+underline+inverse; others inverse default (`fullscreen-search@34:35`, `@6:35`) | current: bold+inverse in `searchMatch*` colors; others: underline | **T** partial: `searchMatchText=#f4bf75`, `searchMatchBg=""` makes the current match close. Underline and "others = plain inverse" ✗ (alt-screen internals). |
| 21 | Scrollbar | none | `│` `#484e52` / `┃` `#97a0a5` (`fullscreen-scrollbar`) | ✗ (user setting `fullscreenScrollbar`; the adapter may not change user settings) |
| 22 | Compaction | `⎿` `#999999`, dim "Compacted…" (`compaction@34:5,16`) | `[compaction]` bold `#a798d7` + text (`compaction-summary-message.js:40–53`) | ✗ (internal component) |
| 23 | Pickers | `✔` `#4eba65`, bold title, italic hint, `#d77757` highlights (`model-picker@29:30`, `login-picker@29:3,39:3`) | `accent`/`muted` without those attrs (g4 accent, muted, dim FAILs) | ✗ (internal selectors) |
| 24 | `warning` | `#ffc107` (`idle@39:2`) | `#cd9a22` (`model-picker@16`) | **T** `warning=#ffc107`. Evidence is indirect: that yellow is observed on the auto-mode line and API error, not on a role-isolated cell. |
| 25 | Footer, user message, inline code, success | `#999999`, `#373737`/`#fff`, `#b1b9f9`, `#4eba65` | match (g4 PASS or INCONCLUSIVE only) | none |
| 26 | Glyph/layout chrome | `⏺` bullets (`#4eba65`/`#ff6b80`/`#ffc107`/`#fff`), `⎿` gutter, `❯` prompt, banner/logo | absent, or Pi branding | ✗ (§5.1) |

**Note on G4 artifacts.** Seven FAILs are comparator artifacts, not visual gaps. They are toolPendingBg ×3, toolSuccessBg `tool-bash-ok-expanded@11:5` and `tool-edit@12:5`, and toolErrorBg ×2. For example, `tool-bash-ok-expanded@11:5` expects `#181818 none` and gets `#181818 bold`. `piAt` lands on the bold `$` title cell (g4.json). The bg is the same in both. The fix is in `compare.ts` pairing or attribute comparison, not in an adapter.

## 2. Adapter design

### Shared mechanism: `restyle`

**Hook.** `pi.registerToolRenderer(resolver)` (`extensions.md:2123`). It is the least powerful hook that reaches built-in tool rows. It is also the only one that composes through `next()`. The alternative of re-registering built-ins with `registerTool` would replace execution; the brief forbids that.

**Resolver.**
```
(toolName, next) => {
  const base = next();
  if (!base || !HANDLED.has(toolName)) return base;   // HANDLED: read bash edit write ls (powershell → bash rules)
  return { ...base, renderCall: wrap(base.renderCall, callRules), renderResult: wrap(base.renderResult, resultRules) };
}
```
`renderShell` and any unhandled slot pass through via the spread.

**Wrapper slot.**
- **Inactive.** If `theme.name !== "claude-default-dark"`, return the built-in's own component untouched. The inert case is byte-identical.
- **Active.** Return `RestyleComponent { inner, render(w), invalidate() }`.
  - `render(w)` calls `inner.render(w)` and maps each line through a pure `(line, ctx) => line`.
  - It wraps the whole map in try/catch and falls back to the raw lines. A throw would otherwise make Pi swap to the plain-text fallback (`tool-execution.js:238,262`).
  - `invalidate()` forwards to `inner.invalidate()`.
- **`lastComponent` handling.** Built-ins do `context.lastComponent ?? new Text(...)` and `setText` on it (`bash.js:78`). So pass `{...context, lastComponent: lc instanceof RestyleComponent ? lc.inner : lc}`. Edit's `state.callComponent` Box is mutated in place by `renderResult` (`edit.js:140`). Because our wrapper delegates `render`, those mutations stay visible.

**Text and width invariant.** Transforms parse each line into SGR runs `{text, fg, bg, attrs}` with a small pure parser, change only fg/bg/attrs, and re-serialize. Visible text is never edited, with one exception: the H1 gutter permutation. `visibleWidth` is unchanged because SGR has zero width.

**Colors.** Build colors only through `theme.style(…, {fg: rgbColor(r,g,b)})`, or `foregroundAnsi`/`backgroundAnsi(color, theme.getColorMode())`. 256-color terminals then get Pi's own downgrade.

**SGR vocabulary.** Emit only `0,1,2,3,4,22,23,24,39,49,38;2,48;2,38;5,48;5`. That is the set `export-html/ansi-to-html.js` understands (tool renderers also feed HTML export, `extensions.md:2527`). It does not handle inverse, which is another reason to prefer bg over inverse.

**Role identification.** Identify roles by exact escape equality with `theme.getFgAnsi(role)`, never by hex literals in rules. Where roles collide in color, the rule restricts itself to the known structure of the tool row. For the diff, the theme change in gap 3 makes `toolDiffAdded`, `toolDiffRemoved` and `toolDiffContext` three distinct colors, so the line class is unambiguous.

### H1: edit diff (gaps 1–5)

- **Slots.** The wrapper goes on both edit slots. The diff lives in the `renderCall` Box (`edit.js:95`, preview or settled). It reaches `renderResult` only when the result diff differs from the preview (`edit.js:56`).
- **Reads.** Only the rendered lines, `context.outputPad`, `width`, and the three diff-role escapes. It does not read `details.diff` or `state.callComponent`; those are internal.
- **Per line.** Strip the `outputPad` left padding and classify by leading fg escape: toolDiffAdded, toolDiffRemoved, or toolDiffContext. Confirm with `/^([+\- ])(\s*\d*) /` on the stripped text.
  - Paint line bg `#3d0100` / `#022800` from the first diff cell (after pad) through `width`. Padding to the right edge is what Box already supplies; the adapter does not add characters. Claude does not paint its own 5-column indent (`tool-edit@13:0–4` has default bg), and the adapter does not either.
  - Gutter (sign + number) keeps the line-role color. Content runs get `#f8f8f2`.
  - `\x1b[7m…\x1b[27m` runs inside removed/added lines become bg `#5c0200` / `#044700`, with fg unchanged.
  - Context lines: gutter numbers get `{fg:#f8f8f2, dim:true}`, content `#f8f8f2`.
- **Optional gutter permutation.** Reorder the 4-cell gutter `"-"+" 2"+" "` to `" 2"+" "+"-"`. Context lines `" "+" 1"+" "` become `" 1"+" "+" "`. Widths are identical (`tool-edit` Claude `"      2 -  const"` vs Pi `" - 2   const"`, same 4 gutter cells). Default on, since it is the only text-moving rule; it has its own unit property (§4).
- **N×N blocks.** Pi diffs intra-line only when exactly one line is removed and one added (`diff.js:106`). For a block of equal-count removed and added runs (Claude's `@13–16` is 2×2), pair line *i* with line *i* and mark segments with an own word-diff of about 30 lines. This is partial: segment boundaries match Claude only on `tool-edit`. Include it behind its own rule so it can be dropped.
- **Theme side.** Set `toolDiffAdded` to `#50c850` and `toolDiffRemoved` to `#dc5a5a`. These are the Claude gutter values. Without the adapter, Pi shows green or red whole lines. That is a reasonable semantic fallback, and I flag it as a change from today's all-`#f8f8f2`.
- **Detection.** `theme.name` is read in the slot.
- **Other themes.** The slot returns `inner` untouched.
- **Other extensions.** The wrapper wraps whatever `next()` returns, including a foreign renderer. The rules only touch exact theme-role escapes, so output from a foreign renderer that does not use them is unchanged (property P7).

### H1b: path argument (gap 9)

In the first rendered line of `read` and `edit` calls only, runs whose fg equals `getFgAnsi("accent")` become default fg (`\x1b[39m`). `write`, `ls`, `grep` and `find` also call `renderToolPath` (`render-utils.js:151`) or use `accent` for a pattern (`grep.js:21`, `find.js:20`). There is no Claude capture of those tools, so they are left unadapted rather than guessed. `read`'s skill label also uses `accent` (`read.js:78`); the rule is limited to the call header line before the label.

### H2: failed tool results (gaps 7–8)

- **Slot.** `renderResult` only, and only when `context.isError` is true (`tool-execution.js:100`).
- **Rule.** In every rendered line, runs with no explicit fg (the `""` default that `toolOutput` resolves to) or with `getFgAnsi("error")` get fg `#ff6b80`. Whitespace-only runs are skipped. `muted` runs such as `Took 0.0s` and `warning` runs are untouched.
- **Bash** is evidenced (`tool-bash-fail-expanded@11:5,12:5`). **Edit/write** error text is **(inferred)** from the same Claude tool-failure semantic. The rule is separately switchable per tool name; ship bash on and edit/write gated until a Claude capture of a failing edit exists.
- **Why a renderer.** `error` cannot be set to `#ff6b80` in the theme because API errors (`api-error@14:2`) are `#ffc107`.

### H3: working indicator (gap 11)

- **Hook.** `ctx.ui.setWorkingIndicator` and `setWorkingMessage` (`extensions.md:2905`). Frames render verbatim (`loader.js:47,65`). The message is wrapped by the border `colorFn` (`loader.js:70`), but inner SGR overrides it.
- **What is drawn.** Frames from Claude's observed glyph set (`✻ ✽ ✢ ✶ ·` in `working-*ms@34:0`, plus `✳` from Claude's known spinner set), each `theme.style(g, {fg: rgbColor(215,119,87)})`. The message is `theme.style("Working", {fg: #d77757})`, which reproduces Pi's literal default text.
- **Evidence limits.**
  - The `intervalMs` is unmeasured. Four snapshots 800 ms apart cannot give it. Take a finer capture before fixing it.
  - The `✳` glyph is not in the captures.
- **Shimmer.** `#eb9f7f` on one letter (`@34:11`) needs a timer-driven `setWorkingMessage`. That is rejected (§5).
- **When applied.** On `session_start` and `agent_start`, when `ctx.ui.theme.name === "claude-default-dark"`. If the theme is not active and this instance applied it earlier, call `setWorkingIndicator()` and `setWorkingMessage()` with no arguments to restore Pi's defaults. A theme switched mid-run catches up at the next `agent_start`.
- **Reload.** `resetExtensionUI` clears the indicator and message (`interactive-mode.js:2038–2040`). `session_start` re-applies.
- **Composition limit.** `setWorkingIndicator` and `setWorkingMessage` are last-writer-wins and have no getter. If another extension sets them after this one, theirs wins. That is documented, not mitigated.

### Theme JSON changes (the "T" rows)

| Role | New value | Evidence |
|---|---|---|
| `toolDiffAdded` | `#50c850` | `tool-edit@15:5` |
| `toolDiffRemoved` | `#dc5a5a` | `tool-edit@13:5` |
| `bashMode` | `#fd5db1` | `shell-run@8:0` |
| `warning` | `#ffc107` | indirect (`idle@39:2`, `api-error@14:2`); flag weak |
| `mdLink` | `""` | `markdown@11:59` (underline stays) |
| `searchMatchText` | `#f4bf75` | `fullscreen-search@34:35` |
| `searchMatchBg` | `""` | same; partial |

`customMessageLabel`, `thinkingText` and the non-medium `thinking*` levels keep their stock values. No Claude capture exists to anchor them.

### Not adapted

- **Header, footer, editor** (`setHeader`, `setFooter`, `setEditorComponent`). The footer already matches in color. The header is branding. The editor border already matches at medium. No capture measures a divergence these hooks could close.
- **`registerMessageRenderer` / `registerEntryRenderer`.** They apply only to extension custom types (`extensions.md:3173`). Compaction, user and assistant messages are internal components.

## 3. Structure

```
extensions/
  index.ts           command (existing) + resolver + session_start/agent_start handlers
  adapters/
    active.ts        isActive(theme): theme.name === "claude-default-dark"
    sgr.ts           parse(line) → runs; serialize(runs). No imports; pure
    restyle.ts       RestyleComponent + wrap(slotFn, rules); try/catch → raw lines
    diff.ts          H1 rules (pure: runs, outputPad, width → runs)
    tool-rules.ts    H1b, H2 rules, per-tool gates
    indicator.ts     H3: build frames/message from a Theme; apply/restore
```

**Runtime imports** (these become `peerDependencies`, pinned to the locked Pi, since renderer text shape is version-sensitive):
- `@earendil-works/pi-coding-agent`: types only (`ExtensionAPI`, `Theme`, `ToolRenderers`).
- `@earendil-works/pi-tui`: `Component` (type), `rgbColor`, `foregroundAnsi`/`backgroundAnsi`, `visibleWidth`.
- No deep imports, no `node:*`, no `process.stdout`, no new dependencies.

**State.** There is no module-level state.
- `RestyleComponent.inner` is per-row instance state.
- The indicator needs one closure boolean (`applied`) so a non-Claude theme does not clobber another extension's indicator.
- Everything else derives from `theme` and `context` on each call.

**Compose rule.** The resolver always calls `next()` and wraps the result. It never replaces it. If `next()` is `undefined`, it returns `undefined`.

## 4. Verification plan

**Harness.** Reuse `development/scripts/capture.mjs` with the package installed, `--theme claude-default-dark`, at 120 columns plus the `-w40/-w80/-w200` variants. Compare with the existing `align.ts`/`compare.ts`. Add `adapter-observations.json` with surface-level observations that do not depend on a Pi role.

| Adapter | Scenes | Claude cells to reproduce |
|---|---|---|
| H1 | `tool-edit`, `tool-edit-expanded` | `@12:5`, `@13:5/9/31`, `@15:5/11/31` (bg, gutter, dim) |
| H1b | `tool-read-expanded`, `tool-edit` | `@10:6`, `@10:8` default fg |
| H2 | `tool-bash-fail`, `tool-bash-fail-expanded` | `@11:5`, `@12:5` `#ff6b80` |
| H3 | `working-800ms … 3200ms` | `@34:0` `#d77757` |
| T | `shell-run`, `fullscreen-search` | `@8:0`; `@34:35` |

**Property checks** (fast-check 4.5.3 under vitest 5.0.2, same as `align.property.test.ts`; seed fixed):
- **P1, text identity.** For generated edit diffs (random old/new text, tabs, CJK, emoji, ≥1×1 and N×N blocks), generated bash output, and paths: `stripAnsi(wrapper.render(w))` equals `stripAnsi(next().render(w))` line for line. With the gutter permutation on, equality holds after applying the inverse permutation.
- **P2, width.** `visibleWidth` per line is equal, and no line exceeds `w`.
- **P3, inert.** With `theme.name ≠ "claude-default-dark"`, the slot returns the identical component instance and byte-equal lines.
- **P4, SGR-only.** Concatenated run texts are equal before and after, except under P1's permutation.
- **P5, idempotence.** `transform(transform(x)) = transform(x)`. This also covers double registration after a reload.
- **P6, no leakage.** The final SGR state of every output line is the default state.
- **P7, identity on foreign input.** Lines with no theme-role escapes come back byte-for-byte.
- **P8, color mode.** With a 256-color `Theme`, output contains no `38;2` / `48;2`.
- **P9, vocabulary.** All SGR codes come from the HTML-export set in §2.

**Lifecycle (extend G7).** Install, select, run the `tool-edit` scene, `/reload`, rerun: output is byte-identical (no stacking). Select `pi-dark` (the stock theme) and rerun: the capture equals the `captures/pi-dark/` baseline.

**Static scan (extend G5).** Allow `registerToolRenderer` and `setWorkingIndicator`/`setWorkingMessage`. Fail on `/dist/`, `process.stdout`, `child_process`, `fs`, and any import outside the three allowed packages.

**Expected G4 effect (estimate, not verified).** Of 49 FAILs: about 15 close by adapter or theme (thinkingMedium 2, bashMode 2, toolDiff gutter/dim 3, toolSuccessBg diff bgs 4, toolOutput 2, accent path 2). 7 are comparator artifacts. About 27 stay open (§6).

**Alignment guard.** Run the `verify-claude-default-dark-alignment` skill before trusting any new G4 numbers, since diff rows move after the gutter permutation and indent differences.

## 5. Rejected options

1. **Text-changing renderers** (`⏺ Update(path)`, `⎿` gutters, collapsed "Read 1 file", `❯` prompt). Rejected. The user asked for the theme, and these change the transcript's words, not its colors. They also break the P1 invariant.
2. **Replace the built-in tools (`registerTool` with `createEditToolDefinition`) to own the renderers.** Rejected: it touches the tool registry, and `registerToolRenderer` + `next()` already composes.
3. **Pass a custom `Theme` into the built-in renderers.** Impossible: they read the imported global theme (§0.1).
4. **Re-implement `renderDiff` using public `renderDiff`'s output as source.** Rejected for rendering the diff ourselves. The call Box has async preview state, `settledError`, and a `renderResult` path that mutates it (`edit.js:56–140`). Post-processing the rendered Box lines keeps all that.
5. **Monokai tokens in diffs via `highlightCode` + SGR remap.** Rejected. `highlightCode` is bound to the global theme and hljs scopes (`theme.js:756–768`). Claude's diff colors follow TextMate scopes (`export`=keyword `#f92672`, `const`=storage `#66d9ef`, same hljs scope). Role→color inversion also collides (comment and number are both ansi:2 in the Pi theme). A bounded TS lexer would overfit one scene.
6. **`highlight.js` as a runtime dependency.** Rejected: DESIGN.md §5/§10 keep the package dependency-free, and it would still not give TextMate scopes.
7. **`registerMarkdownTransformer`.** Rejected: string→string on markdown source cannot style, and injecting ANSI into code fences mutates transcript text.
8. **`setHeader` / `setFooter` / `setEditorComponent` re-skins.** Rejected: no captured color divergence to close (§2 "Not adapted"). They would replace Pi's branding or compose poorly with other editors.
9. **Timer-driven `setWorkingMessage` for the shimmer.** Rejected: a background timer plus last-writer-wins on a shared slot, for one `#eb9f7f` letter whose position and cadence are unmeasured.
10. **Per-level `thinking*` all set to `#888888`.** Rejected: it deletes Pi's thinking-level indicator for a Claude behavior only measured at medium.
11. **Hiding the scrollbar by painting it in the terminal bg.** Rejected: it hardcodes the terminal bg (`terminal-palette.json`) and breaks on other terminals. The correct control is the user's `fullscreenScrollbar` setting.
12. **Writing the user's settings or overriding the user's theme.** Forbidden by the brief and DESIGN.md §6.
13. **`theme_change` events / polling for the theme.** There is no such event. Per-render `theme.name` checks plus `agent_start` need no polling.
14. **Gating H1/H2 on "next() is the built-in".** Rejected. Bash renderers are created fresh per call (`createShellRenderers("$")`, `renderers/index.js:20`), so identity checks fail. Exact-escape rules are safe enough and are covered by P7.

## 6. Unclosable gaps

- **Diff token colors** (gap 6): Monokai/TextMate scopes versus Pi's hljs; no public tokenizer with scopes.
- **Chrome Claude draws and Pi has no counterpart for** (gap 26, plus the `✔`/`⏺`/`⎿` row of gap 10): bullets, gutters, prompt glyph, banner, mode line, `Thought for 1s`.
- **Compaction and custom/branch summary messages** (22): internal components; no public hook for built-in message roles.
- **Pickers and selectors** (23): `✔` `#4eba65`, bold titles, italic hints, `#d77757` highlights.
- **Bash-mode echo row** (14): `#413c41` row bg, `!` as a message gutter.
- **Hardcoded attributes in Pi's Markdown and thinking components** (15–17, 19): link underline, quote glyph and dim, fence lines, bold table header, italic thinking.
- **Code-block token classification** (18): hljs scopes differ from Claude's.
- **Search highlight styling and scrollbar** (20–21): alt-screen internals. A theme can approximate the current-match color only.
- **Collapsed tool summaries** (10): different text, not color.
- **Shimmer, spinner cadence, and the `✳` glyph** (11): unmeasured or needs a timer.
- **Brand logo colors in Pi's header**: hardcoded, by design.

**Open evidence requests** (captures that would unlock more):
1. A failing Claude `edit`/`write` for the H2 inference.
2. Claude expanded thinking for `thinkingText`.
3. Claude bash-mode prompt border for `bashMode`.
4. A fine-interval (~100 ms) spinner capture for H3.
5. Claude `write`/`ls`/`grep` tool headers for H1b.

---

# Coordinator decision (2026-11-13)

**Base:** this design (runner `claude`). Its hook choices are concrete and composable: per-slot theme check, `lastComponent` unwrapping, exact-escape role identification, try/catch fallback to the raw lines, and an explicit SGR vocabulary. The alternative (runner `gpt`, `ADAPTER-DESIGN-alternative.md`) agrees on every gap that can be closed and on every unclosable residual. It differs on the spinner hook (an editor wrapper) and on preserving Pi's text order.

**Grafted from the alternative:**

1. Collapsed `read` and `bash` call headers (`!context.expanded`) and the pending `bash` header are restyled to `#999999` and non-bold. This changes color and attribute only; the text stays Pi's. Evidence: `tool-read@10:2`, `tool-bash-ok@10:2`, and `tool-pending@11:0`. This replaces the base design's ✗ for gap 10's color portion.
2. Working-indicator negative controls: the orange applies only to ordinary working state, never to retry or compaction indicators. Verify both.
3. Process rule: a semantic region is recognized from tool structure plus role escape, never from color alone.

**Decided against the base design:**

- **Thinking levels.** Claude Code 2.1.323 was captured at `/effort low`, `medium`, `high`, `xhigh`, and `max` (scenes `effort-*`). Its prompt border is `#888888` at every level. So `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, and `thinkingMax` map to `#888888`, measured. `thinkingOff` and `thinkingMinimal` have no Claude level and keep Pi stock. This reverses rejected option 10, because the evidence that was missing now exists.
- **Gutter permutation (H1).** Keep it on. The user asked for parity as close as possible, and the permutation keeps width.
- **Theme value changes** from the T table go through a coordinator `mapping-review/overrides.json` with capture pointers. The generator validates each pointer like any other. `warning=#ffc107` is included as an override only if a role-isolated Pi `warning` cell pairs with a Claude cell of that color; otherwise it stays stock.
