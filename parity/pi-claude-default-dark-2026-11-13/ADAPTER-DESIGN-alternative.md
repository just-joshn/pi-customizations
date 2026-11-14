# Claude Default Dark: Public-API Adapter Design

**Label:** `gpt`  
**Target:** Pi 1.5.2; Claude Code 2.1.322, built-in `dark`  
**Status:** Design proposal—not an implementation or parity certification.

## Decision

Keep the existing theme and activation command. Add narrowly scoped, compositional tool-renderer decorators and an editor display decorator. Preserve Pi’s text, geometry, interaction, tool execution, and model-visible behavior.

**100% application-wide parity is not attainable under these constraints.** Some differences are reachable only through replacement-only UI slots, some have no allowed rendering hook, and some reference states have not been captured.

The current evidence remains **BLOCKED**: G4 reports 58 passing, 49 failing, and 80 inconclusive observations; G3 and G8 also fail. This design does not turn those into passes merely by proposing adapters.  
[Evidence: `development/PARITY_REPORT.md:14–23`, `development/results/g4.json:1–13`.]

### Citation conventions

Paths beginning with `development/`, `extensions/`, or `themes/` are relative to `extensions/pi-claude-default-dark/`.

`HOST/` means:

```text
/Users/josh-desktop/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/
```

Capture pointers are zero-based parsed terminal coordinates in `development/captures/claude/<scene>.ansi`, unless explicitly marked **Pi**. “Default” means terminal default, not a guessed RGB. The pinned G4 environment resolves default foreground/background to `#d8d8d8`/`#181818`; runtime adapters must not substitute those resolved values for terminal defaults.

---

## 1. Gap inventory

The table distinguishes **styling that can be repaired**, **structural differences deliberately preserved**, and **missing evidence**. A `renderer-required` ledger classification does not itself prove that a suitable allowed hook exists.

### Diff surfaces

| Difference | Claude value and pointer | Pi now | Closure |
|---|---|---|---|
| Removed line background | `#3d0100`, `tool-edit@13:9` | Default panel background | `registerToolRenderer`: decorate edit diff cells, preserving characters and wrapping. |
| Added line background | `#022800`, `tool-edit@15:11` | Default panel background | Same edit decorator. |
| Removed intra-line background | `#5c0200`, `tool-edit@13:31` | Inverse video on changed words | Convert recognized diff inverse spans to explicit background, clearing inverse only there. |
| Added intra-line background | `#044700`, `tool-edit@15:31` | Inverse video | Same. Exact Claude intra-line segmentation requires additional verification; matching Pi’s segmentation is not proof of Claude’s. |
| Removed gutter | `#dc5a5a`, `tool-edit@13:5` | Entire line `#f8f8f2` | Edit decorator separates Pi’s existing sign/number cells from code cells. |
| Added gutter | `#50c850`, `tool-edit@15:5` | Entire line `#f8f8f2` | Same. |
| Context gutter | `#f8f8f2` plus dim, `tool-edit@12:5` | `#f8f8f2`, no dim | Apply dim only to existing gutter cells. |
| Removed code foreground | `#f8f8f2`, `tool-edit@13:11` | Already off-white | Preserve; do not color removed code uniformly red. |
| Context/added syntax | Pink `#f92672`, cyan `#66d9ef`, green `#a6e22e`, orange `#fd971f`, purple `#be84ff`; `tool-edit@12:9`, `12:22`, `12:31`, `12:42`, `15:31` | One foreground per diff line | Edit decorator plus a separately verified lexical classifier. Publicly reachable, but not solved by remapping `toolDiff*` or Pi’s normal syntax roles. |
| Diff geometry and line pairing | Claude gutter, ordering, and intra-line regions in `tool-edit@12–16` | Pi’s own numbered diff representation and word-diff pairing | Preserve Pi geometry. Do not claim structural parity. |

Pi’s diff parser, three-space tab replacement, single-removed/single-added intra-line pairing, and inverse styling are explicit in `HOST/dist/modes/interactive/components/diff.js:7–68,77–149`.

### Tool surfaces

| Difference | Claude value and pointer | Pi now | Closure |
|---|---|---|---|
| Successful output | Default, `tool-bash-ok-expanded@11:5` | Default | Theme already supplies the right baseline; preserve. |
| Failed Bash output | `#ff6b80`, `tool-bash-fail-expanded@11:5`, `12:5` | Default | Bash result decorator using `context.isError`; recolor output, not the entire component. |
| Collapsed Read/Bash title | `#999999`, non-bold except summary count; `tool-read@10:2`, `10:7`, `tool-bash-ok@10:2` | Default, bold | Call decorator uses `context.expanded`; restyle Pi’s existing heading text. Claude summary wording/count cannot be reproduced while retaining identical Pi text. |
| Expanded tool title | Default bold, `tool-bash-ok-expanded@10:2`, `tool-read-expanded@10:2` | Default bold | Preserve. |
| Edit title | Default bold, `tool-edit@10:2` | Default bold | Preserve in collapsed and expanded states. |
| Tool path argument | Default, `tool-read-expanded@10:6`, `tool-edit@10:8` | Lavender `accent` | Scope a call decorator to recognized path spans for Read/Edit. |
| Pending command | Gray/plain, `tool-pending@11:0`, `11:9` | Bold command heading | Call decorator can remove bold and gray the existing heading while execution is pending. Preserve command text. |
| Tool panel backgrounds | Default for pending, success, failure; `tool-pending@11:9`, `tool-bash-ok-expanded@11:5`, `tool-bash-fail-expanded@12:5` | Already default | Keep theme values. Several G4 “background” failures are attribute failures, not incorrect background RGB. |
| Read result count | Default bold count, `tool-read-expanded@11:10` | Pi displays file content rather than Claude’s “Read 4 lines” summary | No corresponding count to restyle. Adding one changes text/geometry; reject. |
| Tool status bullets | Green success `#4eba65`, red failure `#ff6b80`; `tool-read-expanded@10:0`, `tool-bash-fail-expanded@10:0` | No equivalent independent bullet | Tool hook could add glyphs, but that violates the identical-text design. Residual structural gap. |
| Result connector | `#999999`, `tool-read-expanded@11:0` | No Claude-style `⎿` gutter | Same: do not insert new geometry. |

Bash uses a global theme internally, including `toolOutput`, rather than its supplied `_theme`: `HOST/dist/core/tools/renderers/bash.js:11–21,35–49,70–86`. Therefore passing a modified theme argument alone would not repair Bash.

### Editor and working indicator

| Difference | Claude value and pointer | Pi now | Closure |
|---|---|---|---|
| Medium-effort prompt rules | `#888888`, `idle@36:0` | `#888888`; G4 passes | Keep `thinkingMedium`; no adapter needed for this captured idle state. |
| Working spinner/label | `#d77757`, `working-800ms@34:0` | Shares thinking-level border color, `#888888` | Editor display decorator can restyle recognized embedded working-status cells, leaving rule cells unchanged. |
| Moving working highlight | `#eb9f7f`, `working-1600ms@34:11` | No matching shimmer | Reachable only as an independently specified animation. Two sampled frames do not establish the complete animation; leave uncertified. |
| Working progress metadata | `#999999`, `tool-pending@34:11` | Pi’s own working message/status | Restyle only existing corresponding metadata, if present. Do not invent token counts or timings. |
| Busy prompt chevron | Gray while busy, `working-800ms@37:0`; default idle, `idle@37:0` | No identical Claude chevron surface | Preserve editor text; do not insert or reinterpret a user-entered glyph. |
| Other effort-level borders | No captured corresponding reference | Pi has seven reasoning-level colors | Unobserved, not proven matches. Do not flatten every level based on the medium capture. |
| Bash-entry border | Not captured; `shell-mode` is transcript view | Pi uses `bashMode` | No calibrated target. Keep existing Pi behavior. |

Pi embeds status into its top border and has narrow-width fallback behavior: `HOST/dist/modes/interactive/components/custom-editor.js:20–54`. Custom editors default to a separate working row unless `embedWorkingStatus: true`: `HOST/docs/extensions.md:3135–3159`.

### Transcript, Markdown, search, and chrome

| Difference | Claude value and pointer | Pi now | Closure |
|---|---|---|---|
| Ordinary user message | White on `#373737`, `assistant-text@12:2`, `unicode@12:2` | Matches on text-aligned observations | Keep theme. |
| User chevron | Gray on user background; `api-error-expanded@6:0` | No independently styled corresponding marker | Not closable through an allowed built-in user-message render hook. |
| Assistant/API bullets | White assistant; yellow API failure; `assistant-text@14:0`, `api-error@14:0` | No corresponding bullet | No allowed built-in assistant-message decorator. |
| API error text | `#ffc107`, `api-error@14:2` | Same color; alignment inconclusive | Preserve `error`; verify exact surface alignment before passing. Do not change global `error` to tool-failure red. |
| Markdown link foreground | Default, `markdown@11:59` | `#69add0` | Set `mdLink` to terminal default. |
| Markdown link underline | None, `markdown@11:59` | Forced underline | Not closable by theme or the allowed hooks. |
| Quote border | Default plus dim, `markdown@19:2` | `#9da5a9`, no dim; different glyph | Theme can correct foreground only. No allowed assistant-Markdown post-render hook for dim/glyph. |
| Headings, inline code, lists, URLs | Default bold heading; lavender inline code; default list/URL; `markdown@9:2`, `13:25`, `13:2`, `11:64` | Matching colors in observed cases | Preserve; improve inconclusive alignments rather than add adapters. |
| Horizontal rule | Default literal `---`, `markdown@26:2` | Full-width rule | Color already matches; geometry remains. |
| Table | Default frame/text, `markdown@28:0` | Pi’s table layout | No independently measured color failure; structural parity not established. |
| Language-less code | Lavender, `code-tokens@18:2` | Matches | Preserve `mdCodeBlock`. |
| Fences/language labels | No fences; unsupported-language label default+dim, `mermaid@10:2` | Visible fences/language markers | No allowed built-in assistant code-block decorator. |
| Mermaid | Default source, `mermaid@11:2`, `12:4` | Rendered diagram | Cannot turn diagram into source using theme values. |
| Function syntax boundaries | ANSI3 name, default punctuation, ANSI4 return types; `markdown@21:24`, `21:31`, `21:46` | One `syntaxFunction` span | No single theme value works; no allowed assistant-code renderer hook. |
| Parameter syntax boundaries | ANSI6 identifier, default colon; `markdown@21:32`, `21:35` | One `syntaxVariable` span | Same limitation. |
| Built-ins versus types | Default `console`, ANSI6 `string`; `code-tokens@12:2`, `markdown@21:37` | Both `syntaxType` | Same limitation. |
| Call identifiers | ANSI3 `log`, `code-tokens@12:10` | Unstyled | No role reaches these cells. |
| Thinking disclosure | Gray, non-italic, duration bold; `thinking@14:2`, `14:14` | Italic thinking content/disclosure | No allowed built-in thinking renderer; expanded Claude thinking content also unobserved. |
| Collapsed compaction | Default+dim, `compaction@34:5`, `34:16` | Default plain body, gray expansion hint, bold label | No allowed built-in compaction renderer. |
| Expanded compaction | Default background/body, `compaction-expanded@0:5` | Matches at text anchor | Preserve theme; does not resolve collapsed styling. |
| Ordinary search match | Default+inverse, `fullscreen-search@6:35` | Different fixed attributes/colors | No allowed search decorator; one pair of theme roles cannot express both states. |
| Current search match | ANSI3+bold+underline+inverse, `fullscreen-search@34:35` | `#9da5a9`+bold+inverse | Same limitation. |
| Search count | Gray, `fullscreen-search@39:113` | Pi’s search UI | No allowed dedicated hook. |
| Selection | Captured picker selection is foreground, not mouse selection; `login-picker@35:3` | Pi selection backgrounds on other surfaces | Mouse-selection reference missing. Do not treat picker foreground as `selectedBg` evidence. |
| Scrollbar | No visible Claude track/thumb in `fullscreen-scrollbar` | Pi draws track/thumb glyphs | Colors cannot remove glyph geometry; no allowed scrollbar hook. |
| Submitted shell command | Pink `!`, white command on `#413c41`; `shell-run@8:0`, `8:2` | Pi Bash execution panel/borders | Model-tool renderer does not own user `!` execution display. No allowed display hook. |
| Submitted shell output | Default, `shell-run@9:5` | `muted` gray | Cannot fix globally without damaging secondary UI; user-Bash component lacks an allowed render decorator. |
| Picker title/selection | Lavender bold title; green current model; italic gray cancel hint; `login-picker@29:3`, `model-picker@29:30`, `login-picker@39:3` | Shared `accent`, plain hints | Theme fixes common colors only; no allowed built-in picker render decorator. |
| Picker featured model/effort slider | Orange `#d77757`, `model-picker@31:33`, `37:3` | Different Pi controls | No same-surface allowed decorator. |
| Header/logo | Orange on black logo, default bold title; `idle@1:2`, `1:11` | Pi logo/title | `setHeader` can replace it, but has no getter/`next()` composition. Do not overwrite another extension’s header or relabel Pi as Claude Code. |
| Footer metadata | Gray, `idle@35:100`, `assistant-text@35:90` | Gray metadata; some exact matches | Keep `dim`/`muted`. |
| Permission-mode footer | Yellow mode, gray hint; `idle@39:2`, `39:17` | Pi has no Claude permission-mode state | Do not fabricate it. `setFooter` is replacement-only. |
| Transcript footer/divider | Gray footer, default+dim divider; `fullscreen-scrollbar@39:2`, `api-error-expanded@38:0` | Pi’s fullscreen chrome | No compositional access to built-in transcript chrome. |
| Done/timestamp rows | Gray; `assistant-text@16:0`, `api-error-expanded@10:92` | Different/missing rows | Do not synthesize Claude timing/model metadata. |
| Warning and generic custom labels | No adequately corresponding capture | Stock-Pi fallback values | Evidence gap, not permission to guess. |

These distinctions incorporate the reviewers’ disagreements: notably scrollbar roles paint foreground glyphs despite the merged ledger’s background label; compaction and tool-background failures can actually be attribute differences; and `success` does not automatically own the current-model check.  
[Evidence: `development/mapping.json`, `development/mapping-review/claude.json`, and `development/mapping-review/gpt.json`, corresponding role records and `claudeOnly` entries.]

---

## 2. Adapter design

### 2.1 Common confinement rules

1. **Theme identity is checked at render time.** Use the current public `Theme.name === "claude-default-dark"`, not startup settings, palette equality, or a cached boolean. `Theme.name` is public.  
   [Source: `HOST/dist/modes/interactive/theme/theme.d.ts:36–39`.]

2. **Other themes delegate unchanged.** Retained decorators become exact pass-throughs immediately after a theme switch. They must not require `/reload`.

3. **Resolve through `next()`.** For each eligible tool, obtain the downstream renderer once per resolver invocation. If absent, return it unchanged. Preserve its `renderShell`, optional methods, and downstream behavior.  
   [Source: `HOST/docs/extensions.md:2123–2135`; `HOST/dist/core/extensions/types.d.ts:541–546`.]

4. **No execution hooks.** Do not register replacement tools, intercept results, modify arguments, or manufacture session messages.

5. **Preserve downstream component identity internally.** A decorator must pass the downstream component—not its outer wrapper—as `context.lastComponent` on the next invocation. Forward the original state, invalidation callback, key hints, arguments, and result unchanged.

6. **No global ANSI replacement.** Recognize semantic regions inside the specific decorated surface. A lavender substring is not sufficient evidence that text is a path.

### 2.2 Tool-title and path decorator

**Hook:** `pi.registerToolRenderer`.

**Scope:** Initially `read`, `bash`, and `edit`, because supplied captures establish their mismatches. Do not automatically apply these styles to unrelated custom tools or MCP tools.

**Reads:**

- Tool name and downstream renderer.
- `context.expanded`, `executionStarted`, `isPartial`, and `isError`.
- Read/Edit path arguments, including the supported `file_path` alias.
- Rendered downstream component lines.

**Draws:**

- Existing collapsed Read/Bash heading: gray, with title bold removed.
- Existing expanded heading: unchanged.
- Existing Edit title: unchanged.
- Recognized Read/Edit path span: terminal default.
- Pending Bash heading: gray/plain where the captured state applies.

The decorator does **not** replace “read path” with “Read 1 file,” invent a result count, or add bullets. Those are layout/content adaptations, not styling repairs.

**Text and width preservation:** Render downstream at the original width, then change only SGR on validated cells. Preserve every other escape, character, line, and column.

Read’s compact resource/skill rendering requires explicit pass-through cases: it has different labels and disclosure hints, not merely an ordinary path header.  
[Source: `HOST/dist/core/tools/renderers/read.js:20–28,65–80,113–124`.]

### 2.3 Failed Bash output decorator

**Hook:** Same renderer resolver, decorating `renderResult`.

**Reads:** `context.isError`, `options.isPartial`, `options.expanded`, result text/details, and downstream rendered lines.

**Draws:** `#ff6b80` on validated failed-output spans; preserves success output, truncation warnings, expansion hints, full-output paths, and elapsed-time metadata.

Use `context.isError`, **not** a speculative `result.isError`: Pi passes only `content` and `details` to the result renderer and supplies the error state in context.  
[Source: `HOST/dist/modes/interactive/components/tool-execution.js:80–102,251–254`.]

Delegate Bash rendering so that its five-visual-line tail preview, warning footer handling, and timers remain intact. A broad outer red foreground is insufficient because nested SGR resets and semantic warning spans must remain correct.  
[Source: `HOST/dist/core/tools/renderers/bash.js:23–68`.]

Preserve explicit user-output colors unless a separately approved contract requires overriding them; the supplied plain failure fixture does not establish how Claude treats arbitrary colored subprocess output.

### 2.4 Edit-diff decorator

**Hook:** Decorate **both** `renderCall` and `renderResult`.

This is essential: Pi shows asynchronously computed preview diffs in the call component and can later move the authoritative result diff into that component. A result-only replacement would miss the visible diff or duplicate it.  
[Source: `HOST/dist/core/tools/renderers/edit.js:113–159`.]

**Reads:**

- Path arguments.
- Final `details.diff` and `firstChangedLine`, when available.
- The downstream rendered call/result.
- Existing diff foreground/inverse spans.
- Public context and downstream invalidation.

**Draws, in stages:**

1. Verified gutter colors and context-gutter dim.
2. Added/removed line backgrounds.
3. Explicit intra-line backgrounds replacing Pi inverse spans.
4. Independently verified syntax spans for supported fixture languages.

The adapter must not read files, run its own preview computation, or inspect private `Box.preview` properties. Downstream retains responsibility for preview lifecycle.

**Recognition:** Validate a diff region using its component location, Pi’s numbered-line grammar, and, when available, the authoritative diff. Never recolor arbitrary error text merely because a line begins with `+` or `-`.

**Syntax is a separate deliverable.** Pi’s public `highlightCode()` uses its normal global syntax palette; it does not accept a separate Monokai palette. Its token boundaries already differ from Claude’s. Therefore calling it and swapping a handful of colors does not prove exact diff syntax.  
[Source: `HOST/dist/modes/interactive/theme/theme.d.ts:145–149`; captured conflicts `markdown@21:31`, `21:35`, `21:46`.]

A package-owned lexical classifier can operate on diff source text without changing execution. Start with the measured TypeScript fixture and preserve unknown spans as off-white. Certification must state its supported language/context domain. Truncated hunks can lack lexical context; unknown regions remain unresolved rather than guessed.

**Wrapping:** Construct style spans in logical source offsets, then project them onto the downstream output’s existing visible cells. Do not independently wrap or truncate. If the projection cannot be validated, leave that region unchanged and report the case in verification.

**Background extent:** Style existing diff cells and existing padding only. Do not add spaces to mimic Claude’s wider colored region.

### 2.5 Editor display decorator

**Hook:** `ctx.ui.getEditorComponent()` followed by `setEditorComponent()`.

Capture the previous factory before installing the wrapper. If absent, instantiate public `CustomEditor` with `embedWorkingStatus: true`, matching Pi’s embedded-status arrangement.  
[Source: `HOST/docs/extensions.md:2987–2994,3135–3165`; `HOST/dist/modes/interactive/interactive-mode.js:416`]

**Reads:** Current theme during rendering; downstream editor output; public editor callbacks/capabilities; working-state events only if necessary to distinguish working from retry/compaction.

**Draws:** Restyles only a recognized working-status region in the editor’s existing border:

- Rule cells remain the original border style.
- Spinner and existing working label become `#d77757`.
- Existing metadata can remain gray.
- No new verb, chevron, timing, row, or token counter.

Do not recolor retry, compaction, or branch-summary indicators as ordinary working output: Pi has distinct indicator kinds and warning semantics.  
[Source: `HOST/dist/modes/interactive/components/status-indicator.js:22–58`.]

**Composition:** Explicitly forward the full public editor contract, focus, cursor marker, input/paste behavior, callbacks, appearance setters, and working-status attachment capabilities. Forward Pi’s app-action integration as well; an apparently harmless wrapper that omits these can break interrupts or model switching.  
[Source: `HOST/dist/modes/interactive/interactive-mode.js:2337–2385`; `HOST/docs/tui.md:38–48`.]

If another editor does not expose a recognizable embedded status surface, leave it untouched. Preserve its separate working row rather than commandeering that row.

**Why not `setWorkingIndicator()` by default?** It is the least powerful hook for **frame glyph styling**, but not for the whole shared-color problem:

- Custom frames are verbatim strings.
- They do not independently style the existing message.
- The API provides no getter for restoring another extension’s frames.
- The allowed event surface has no documented theme-change event for rebuilding stored colored frames immediately.

[Source: `HOST/docs/extensions.md:2904–2918,3011`; `HOST/dist/core/extensions/types.d.ts:108`.]

Thus the composable editor decoration closes more of the measured mismatch without persistent colored frame state. Full Claude shimmer/animation remains outside the certified result.

### 2.6 Theme-only corrections

Correct `mdLink` foreground to terminal default. A foreground-only correction may also improve `mdQuoteBorder`, but must not be described as fixing its dim attribute or glyph.

Keep terminal-default panel backgrounds and existing passing user-message colors. Do not change `error` to red, `muted` globally to default, or `accent` globally to green to fix unrelated contextual surfaces.

### 2.7 Reload and coexistence

Register one renderer resolver per extension initialization. Install one editor wrapper per `session_start`, with no external registry or persistent wrapping state.

Pi resets extension header/footer/editor/working-indicator UI during reload and session switches. Rely on this lifecycle rather than attempting to restore a captured factory over newer owners.  
[Source: `HOST/dist/modes/interactive/interactive-mode.js:2015–2044`.]

Another tool renderer remains authoritative for text/layout. Decorate only recognized compatible surfaces; otherwise pass through. An upstream resolver that never calls `next()` can prevent these adapters from running—this is a documented compatibility limit, not something to defeat.

Do not install header/footer replacements: their documented interfaces replace the whole slot and offer no equivalent composition getter.  
[Source: `HOST/docs/extensions.md:2928–2943`.]

---

## 3. Structure

```text
extensions/
├── index.ts
└── adapters/
    ├── tools.ts
    ├── editor.ts
    ├── diff.ts
    ├── diff-syntax.ts
    └── sgr.ts
```

- **`index.ts`:** Existing `/claude-theme status|use` command plus adapter registration. Keep explicit `use` as the only theme-changing action.
- **`tools.ts`:** Resolver composition, downstream component reuse, title/path/error-output policies.
- **`editor.ts`:** Public editor delegation and narrowly recognized working-status styling.
- **`diff.ts`:** Diff-region validation, gutter/background policies, source-to-rendered-cell projection.
- **`diff-syntax.ts`:** Pure, evidence-scoped lexical classification; no file reads or external grammar loader.
- **`sgr.ts`:** Small pure SGR parser/rewriter that preserves text, non-SGR escapes, and column boundaries.

Runtime imports:

| Package | Imports |
|---|---|
| `@earendil-works/pi-coding-agent` | Public `CustomEditor`; public API/types as needed |
| `@earendil-works/pi-tui` | Public component/editor types and width utilities; concrete-color utilities if required |

Declare host-compatible **peer dependencies**, validated against the installed 1.5.2 packages. Do not import `dist/...`, execution modules, internal renderers, or private theme singletons.

The current extension’s explicit activation behavior is preserved: `extensions/index.ts:3–26`.

### State policy

No session entries, model state, files, global timers, watchers, or network access.

Necessary ephemeral state is limited to:

- A wrapper’s downstream component reference.
- Per-render-slot metadata needed for delegation.
- Pure layout/token caches keyed by content, width, and current theme, cleared by `invalidate()`.

“No state” must not mean breaking downstream reuse: the public renderer contract explicitly provides per-row state and previous components.  
[Source: `HOST/dist/core/extensions/types.d.ts:367–398`.]

---

## 4. Verification plan

### Baseline and treatment

Capture stock Pi, current theme-only Pi, and theme-plus-adapter Pi under the existing pinned terminal lock. Use identical synthetic tool results and arguments.

Do not calculate expected improvement by subtracting all 49 failures: several are role-only pairings, background observations containing attribute failures, or comparisons between structurally different surfaces.

### Adapter matrix

| Adapter | Required scenes/checks |
|---|---|
| Title/path | `tool-read`, `tool-read-expanded`, `tool-edit`, `tool-edit-expanded`, `tool-bash-ok`, `tool-bash-ok-expanded`, `tool-pending`; additionally compact skill/resource reads |
| Failed output | `tool-bash-fail`, `tool-bash-fail-expanded`; successful control; partial output, cancellation, colored output, truncation/full-output footer |
| Diff | `tool-edit`, `tool-edit-expanded`; pending preview, settled result, failure, resumed result, single-line replacement, multi-line replacement, additions/deletions, tabs |
| Working/editor | `idle`, `working-800ms`, `working-1600ms`, `working-2400ms`, `working-3200ms`, `tool-pending`; retry/compaction negative controls |
| Theme-only corrections | `markdown`, `code-tokens`, `mermaid`; confirm only intended roles change |

### Property checks

1. **Exact text preservation:** Remove only SGR; decorated and downstream output arrays are identical, including non-SGR escape sequences and line boundaries.
2. **Width preservation:** Every corresponding line has identical visible width; no line exceeds its supplied width.
3. **Cell confinement:** Changed styles occur only inside approved semantic spans.
4. **Style restoration:** No foreground, background, inverse, or dim bleed into adjacent cells or wrapped lines.
5. **Other-theme identity:** Under every non-target theme, output is byte-identical to downstream.
6. **Component reuse:** Downstream receives its own prior component, not the decorator; edit asynchronous invalidation still updates the visible preview.
7. **Composition:** Test cooperating renderers both before and after this resolver, custom editors, and a non-delegating upstream renderer.
8. **Lifecycle:** Repeated `/reload`, session switch, resume, and theme switch create no duplicate wrappers or stale ANSI.
9. **Editor behavior:** Preserve input, app shortcuts, autocomplete, image paste, focus, IME placement, mouse routing, and working-status attachment.
10. **Behavioral preservation:** Model requests, tool schemas, tool calls/results, and session entries match the theme-only control.

Run width cases at 40/80/120/200 columns, plus very narrow status-fallback cases, CJK, emoji, combining marks, resize, and both regular/fullscreen mode. Use the public TUI width utilities rather than code-unit lengths.  
[Source: `HOST/docs/tui.md:23–29,38–48,203–209`.]

### Evidence gates

- Assert actual parsed characters at every new `piAt`/`claudeAt` before comparing color.
- Validate alignment with the project’s alignment-verification skill before trusting revised G4 scores.
- Replace role-only observations with text- or semantic-span-aligned evidence where possible.
- Check foreground, background, and attributes separately.
- Keep unsupported syntax, animation phases, and uncaptured states **INCONCLUSIVE**.
- Re-run G5–G9; do not inherit the old passes after adding runtime code.
- Retain G10’s reviewed-hash requirement.

No verification was executed for this design.

---

## 5. Rejected options

| Alternative | Reason rejected |
|---|---|
| Theme JSON alone | Cannot express shared-role contextual colors, diff backgrounds, or contextual attributes. |
| Global role changes to fix local surfaces | Green `accent`, default `muted`, or red `error` would damage other measured contexts. |
| Register replacement built-in tools | Changes the tool registration boundary and risks model/execution behavior; unnecessary when renderer resolution exists. |
| Reimplement all built-in renderer text/layout | Duplicates truncation, timers, compact reads, image handling, preview lifecycle, and key hints. Violates identical-text intent. |
| Replace only edit `renderResult` | Misses preview/final diffs rendered in the call component. |
| Pass a modified theme object to downstream renderers | Bash and diff rendering use the internal global theme; this does not reliably affect them. |
| Monkey-patch global theme/renderers | Explicitly forbidden and load-order fragile. |
| Import internal `renderDiff` or renderer modules through `dist` | Explicitly forbidden. Public root exports are the only acceptable import route. |
| Blind replacement of ANSI colors | Shared/default colors do not identify semantic regions; corrupts arbitrary output and other extensions. |
| Broad outer error foreground | Nested resets can defeat it; also recolors warnings, hints, and metadata. |
| Hard-coded file names or capture strings | Fits fixtures rather than the public rendering contract. |
| Add Claude bullets, gutters, summaries, or timing rows | Changes text and geometry; often fabricates state Pi does not have. |
| Replace header/footer | Public but replacement-only, with no supported composition getter. Risks clobbering another extension and discarding Pi information. |
| Use `setWorkingIndicator()` as the complete spinner solution | Frames do not independently style the message; frame ownership/restoration and immediate theme switching are unresolved. |
| Recreate Claude animation from sampled frames | Inadequate temporal evidence; no justified full-frame/interval specification. |
| Re-tokenize all assistant Markdown through tool hooks | Tool hooks do not own assistant Markdown. |
| Use Markdown/message/entry registration outside the brief’s allowed hook list | The brief specifically permits tool renderers, commands, events, and named UI mechanisms. Expanding that boundary needs approval; custom message renderers also do not automatically own built-in messages. |
| Hide glyphs by setting foreground equal to background | Not removal, breaks selection/copy/accessibility, depends on background assumptions. |
| Force the target theme on startup | Violates explicit user theme choice. |
| Poll theme settings or write directly to the terminal | Unnecessary service/render loop; direct stdout is forbidden. |

---

## 6. Unclosable gaps

Under the stated API boundary and identical-text/width contract, these remain:

1. **Built-in assistant Markdown rendering:** forced link underline, quote-border dim/glyph, fences, Mermaid source-versus-diagram behavior, and incompatible syntax token boundaries.
2. **Built-in thinking presentation:** italic content versus Claude’s duration disclosure; expanded reference content is also missing.
3. **Built-in compaction presentation:** label, collapsed dim styling, and expansion hint.
4. **Built-in picker context styling:** green current-model item/check, title attributes, italic hints, and featured-model emphasis.
5. **Search-state attributes:** ordinary versus current inverse/underline/color behavior.
6. **Scrollbar geometry and unobserved mouse-selection styling.**
7. **User-message markers, assistant/API bullets, and Claude-only completion/timestamp rows.**
8. **User `!` Bash command panel and output:** not owned by the model-tool renderer hook.
9. **Compositional header/footer replacement:** public setters exist, but safe ownership-preserving composition does not.
10. **Claude permission-mode and product-specific chrome:** Pi has no equivalent state; fabricating it is not theme parity.
11. **Exact full animation parity:** sampled frames do not establish the animation; an incompatible custom editor may also expose no decoratable working surface.
12. **Exact diff syntax and intra-line segmentation outside verified cases:** publicly drawable, but unresolved until classifier coverage and reference segmentation are established.
13. **Uncaptured effort levels, warnings, hover/selection states, and other missing reference observations.**
14. **Structural differences intentionally preserved:** Pi tool wording, counts, gutters, line order, and panel geometry cannot simultaneously remain identical to Pi and become identical to Claude.

**Result:** This design closes concrete, locally reachable styling gaps without pretending that a theme adapter can make two different interfaces identical. The release claim should be **“Pi-native Claude-default-dark styling with verified scoped adapters”**, accompanied by a surface-by-surface residual ledger—not “100% Claude Code parity.”
