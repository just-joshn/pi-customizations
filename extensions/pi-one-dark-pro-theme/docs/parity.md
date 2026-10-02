# Parity report: pi-one-dark-pro-theme

Pi package `extensions/pi-one-dark-pro-theme` (pi 1.0.0) reproduces the Visual Studio Code theme
**One Dark Pro Flat** as a Pi theme. Every value in `themes/one-dark-pro-flat.json` is computed
from the pinned file in `upstream/`, so the theme cannot drift from the source without failing
`bun run check:parity`.

## What a theme file can express

Pi reads a theme JSON, not a VS Code theme. `docs/themes.md` defines five top-level properties:
`$schema`, `name`, `vars`, `colors`, and `export`. `colors` assigns values to interface roles,
and `export` overrides the page, card, and info backgrounds used by HTML export.

The schema defines the exact role set: 51 required color roles, 5 optional color roles
(`scrollbarTrack`, `scrollbarThumb`, `searchMatchBg`, `searchMatchText`, `thinkingMax`), and 3
export colors. `additionalProperties` is false at every level, so a role Pi does not define is a
validation failure rather than a silent extra.

A theme file cannot express:

- **Per-language variation.** VS Code chooses a foreground per TextMate scope path and per
  `semanticTokenColors` entry, so the same role renders differently in different languages. Pi
  has one value per role. Where upstream varies, this package picks the scope the role names and
  records the choice in `parity/role-map.tsv`.
- **Font styles.** Italic and bold live in the same VS Code token rules as color
  (`markup.italic`, `markup.bold` set `fontStyle`). Pi's schema has no font style field, so those
  rules contribute color only.
- **Alpha.** Pi accepts `#rrggbb`, a 256-color index, a `vars` reference, or `""`. There is no
  alpha channel, so every translucent upstream key is flattened over the surface VS Code draws it
  on. The four rows that need this are `selectedBg`, `searchMatchBg`, `toolSuccessBg`, and
  `toolErrorBg`, each composited over `editor.background`.
- **Component identity.** Roles such as `toolPendingBg` or `customMessageLabel` describe Pi
  surfaces that VS Code does not have. Each still names an upstream key or scope, and the reason
  for the pick is the `why` column of the role map.

## How a value is derived

`parity/theme.ts` implements four derivation kinds. `parity/role-map.tsv` assigns one kind to
each of the 59 roles: 35 `color`, 17 `scope`, 5 `composite`, and 2 `alpha`.

| Kind | Rule | Worked example |
|---|---|---|
| `color` | Read `colors[source]` from the upstream file. | `accent` reads `inlineChatInput.focusBorder`, so `#61afef`. |
| `scope` | Resolve `source` as one TextMate scope name against the upstream `tokenColors`. | `syntaxKeyword` resolves the scope `keyword`, which the Keywords rule declares as `#c678dd`. |
| `alpha` | Read `colors[source]` and drop the alpha byte. The two scrollbar roles use this, because pi draws them as glyphs and a glyph keeps its own colour rather than blending with what is behind it. | `scrollbarSlider.background` is `#4e566660`, so `scrollbarTrack` is `#4e5666`. |
| `composite` | Read `colors[source]` and `colors[base]`, then alpha-composite the first over the second. The five roles pi paints as a full-cell surface use this. | `toolSuccessBg` flattens `inlineChatDiff.inserted` (`#00809b33`, alpha 51/255) over `editor.background` (`#282c34`): red `0 * 0.2 + 40 * 0.8 = 32`, green `128 * 0.2 + 44 * 0.8 = 61`, blue `155 * 0.2 + 52 * 0.8 = 73`, so `#203d49`. |

`resolveRow` lowercases every result and rejects anything that is not `#rrggbb` or `#rrggbbaa`.

## The scope resolver

`resolveScope` takes one scope name, not a stack. It is exact membership, not a search.

1. Reject a `scopePath` that is empty or holds whitespace. A space-separated value is a
   parent-scope selector, and no row in the map uses one.
2. Walk `tokenColors` in declaration order. A rule's `scope` field may be a string or an array,
   and each entry may be a comma-separated list of names.
3. Return the foreground of the first rule whose name list contains `scopePath` exactly.
4. Throw when no rule names the scope. There is no fallback to `editor.foreground`.
5. Throw when two foreground-carrying rules name the same scope with different colors. The row has
   no single answer at that point, and returning whichever rule came first would hide an upstream
   change behind a plausible color. Two rules that agree on the color are fine, which is how
   `entity.name.function` resolves at two separate points in the file.

**Why `keyword.operator` wins over `keyword`.** The upstream file declares the rule for
`keyword.operator` at index 71 with foreground `#abb2bf`, then the rule for `keyword` at index 74
with foreground `#c678dd`. Both rules name a string that starts with `keyword`, so a prefix search
would have to choose between them, and a plain last-rule-wins walk would paint every operator
purple. Membership decides it without a search: only the rule that names `keyword.operator`
matches, so `syntaxOperator` resolves to `#abb2bf`, which is also the theme's editor foreground.

Dot-segment specificity is not used, and the spec's question about it is answered by the same
two rules. A specificity resolver scores `keyword.operator` at 2 segments against `keyword` at 1
and picks the same `#abb2bf`, so the added code would change no answer for any of the 17 scope
rows. Exact membership also cannot resolve a scope the theme never names, which would let a typo
in the map pass silently. The failure mode is a thrown error that names the scope instead.

## The 59 rows

Generated from `parity/role-map.tsv`. Every value below is also in
`themes/one-dark-pro-flat.json`, and `bun run check:parity` rebuilds the theme and compares.

| Role | Kind | Source | Value |
|---|---|---|---|
| `accent` | color | `inlineChatInput.focusBorder` | `#61afef` |
| `border` | color | `editorGroup.border` | `#23252c` |
| `borderAccent` | color | `panel.border` | `#3e4452` |
| `borderMuted` | color | `editorIndentGuide.background1` | `#343a45` |
| `success` | color | `chat.linesAddedForeground` | `#8cc265` |
| `error` | color | `editorError.foreground` | `#c24038` |
| `warning` | color | `editorWarning.foreground` | `#d19a66` |
| `muted` | color | `sideBar.foreground` | `#969aa4` |
| `dim` | color | `titleBar.inactiveForeground` | `#6b717d` |
| `text` | color | `editor.foreground` | `#abb2bf` |
| `thinkingText` | color | `gitDecoration.ignoredResourceForeground` | `#636b78` |
| `selectedBg` | composite | `editor.selectionBackground` over `editor.background` | `#404859` |
| `scrollbarTrack` | alpha | `scrollbarSlider.background` | `#4e5666` |
| `scrollbarThumb` | alpha | `scrollbarSlider.activeBackground` | `#747d91` |
| `searchMatchBg` | composite | `editor.findMatchBackground` over `editor.background` | `#554941` |
| `searchMatchText` | color | `editor.foreground` | `#abb2bf` |
| `userMessageBg` | color | `chat.requestBackground` | `#2c313c` |
| `userMessageText` | color | `input.foreground` | `#abb2bf` |
| `customMessageBg` | composite | `chat.requestBubbleBackground` over `editor.background` | `#2f343f` |
| `customMessageText` | color | `agentsChatInput.foreground` | `#abb2bf` |
| `customMessageLabel` | color | `editorBracketHighlight.foreground2` | `#c678dd` |
| `toolPendingBg` | color | `editorWidget.background` | `#21252b` |
| `toolSuccessBg` | composite | `inlineChatDiff.inserted` over `editor.background` | `#203d49` |
| `toolErrorBg` | composite | `inlineChatDiff.removed` over `editor.background` | `#3f2e36` |
| `toolTitle` | color | `panelTitle.activeForeground` | `#f0f0f0` |
| `toolOutput` | color | `descriptionForeground` | `#abb2bf` |
| `mdHeading` | scope | `markup.heading` | `#e06c75` |
| `mdLink` | scope | `string.other.link.title.markdown` | `#61afef` |
| `mdLinkUrl` | scope | `markup.underline.link.markdown` | `#c678dd` |
| `mdCode` | scope | `markup.inline.raw.markdown` | `#98c379` |
| `mdCodeBlock` | scope | `meta.embedded` | `#abb2bf` |
| `mdCodeBlockBorder` | scope | `punctuation.definition.raw.markdown` | `#e5c07b` |
| `mdQuote` | scope | `markup.quote.markdown` | `#5c6370` |
| `mdQuoteBorder` | color | `textBlockQuote.border` | `#4b5362` |
| `mdHr` | color | `menu.separatorBackground` | `#343a45` |
| `mdListBullet` | scope | `punctuation.definition.list.begin.markdown` | `#e5c07b` |
| `toolDiffAdded` | color | `chat.linesAddedForeground` | `#8cc265` |
| `toolDiffRemoved` | color | `chat.linesRemovedForeground` | `#e05561` |
| `toolDiffContext` | color | `sideBar.foreground` | `#969aa4` |
| `syntaxComment` | scope | `comment` | `#7f848e` |
| `syntaxKeyword` | scope | `keyword` | `#c678dd` |
| `syntaxFunction` | scope | `entity.name.function` | `#61afef` |
| `syntaxVariable` | scope | `variable` | `#e06c75` |
| `syntaxString` | scope | `string` | `#98c379` |
| `syntaxNumber` | scope | `constant.numeric` | `#d19a66` |
| `syntaxType` | scope | `entity.name.type` | `#e5c07b` |
| `syntaxOperator` | scope | `keyword.operator` | `#abb2bf` |
| `syntaxPunctuation` | scope | `punctuation.separator.delimiter` | `#abb2bf` |
| `thinkingOff` | color | `terminal.ansiBlack` | `#3f4451` |
| `thinkingMinimal` | color | `terminal.ansiBrightBlack` | `#4f5666` |
| `thinkingLow` | color | `terminal.ansiCyan` | `#42b3c2` |
| `thinkingMedium` | color | `terminal.ansiBlue` | `#4aa5f0` |
| `thinkingHigh` | color | `terminal.ansiMagenta` | `#c162de` |
| `thinkingXhigh` | color | `terminal.ansiBrightMagenta` | `#de73ff` |
| `thinkingMax` | color | `terminal.ansiBrightRed` | `#ff616e` |
| `bashMode` | color | `terminal.ansiGreen` | `#8cc265` |
| `export.pageBg` | color | `editor.background` | `#282c34` |
| `export.cardBg` | color | `editorWidget.background` | `#21252b` |
| `export.infoBg` | color | `editorInlayHint.background` | `#2c313c` |

## Direct keys, token-derived rows, and inferred rows

- **Direct keys, 42 rows.** The 35 `color`, 5 `composite`, and 2 `alpha` rows name a key the
  upstream theme authors. A reviewer can open `upstream/OneDark-Pro-flat.json`, search
  `colors[source]`, and see the byte the value came from.
- **Token-derived, 17 rows.** The `scope` rows take the color the upstream theme actually renders
  for a TextMate scope, which is the reason the resolver in `parity/theme.ts` exists. These are
  the rows where "which color does this theme use for X" has an upstream answer that is not a
  workbench key.
- **Inferred, 8 rows.** `thinkingOff` through `thinkingMax` are inferred from the theme's terminal
  accent ladder, because VS Code has no thinking-level concept. `bashMode` uses the same ladder's
  green. The colors are upstream `terminal.ansi*` keys; the mapping from a Pi thinking level or
  shell mode to a ladder step is this package's choice, and it is the one mapping a future Pi
  release could invalidate.

Rows where upstream names no opaque key, and the rule applied instead: `selectedBg`,
`searchMatchBg`, `customMessageBg`, and the two tool state backgrounds flatten a translucent
upstream tint over `editor.background`, the surface VS Code draws it on. `searchMatchText` takes
`editor.foreground`, because pi uses that role as the current-match background as well as text.
`customMessageLabel` takes the second bracket-pair accent. `mdHr` and `mdQuoteBorder` take
separator keys, because upstream names no thematic break.

## Limitations

- **One color per role against per-language upstream values.** `syntaxOperator` is a
  representative choice: the map names the generic `keyword.operator` rule, which renders
  `#abb2bf`. Upstream is not one color there. `keyword.operator.assignment` resolves to
  `#56b6c2` and `keyword.operator.word` resolves to `#c678dd` in the same file, and Pi has one
  operator role. The theme is exact for the scope path named in the map and honest about being a
  single sample elsewhere.
- **No font styles.** Upstream's `markup.italic` and `markup.bold` rules cannot be expressed, so
  italics and bold in Pi remain the terminal's.
- **No alpha.** Pi colors carry no alpha byte, so no tint blends with what is behind it. The map
  composites the four translucent upstream keys onto `editor.background`, the surface VS Code
  draws them on. The upper six digits are not shipped on their own because they would be wrong on
  screen, and the alpha byte is not shipped at all because the schema rejects it.
- **The scrollbar pair is quiet.** The track and thumb take the theme's own
  `scrollbarSlider.background` and `scrollbarSlider.activeBackground`, with the alpha byte dropped
  because pi draws them as glyphs. One Dark Pro's scrollbar is deliberately faint, and pi paints
  one thumb colour, so the active slider stands in for both states. The pair measures 1.90
  track-to-page and 1.79 thumb-to-track, against 2.19 and 5.44 for pi's built-in dark theme. The
  theme looks like its source here, and its source is subtle.
- **Tool success and error backgrounds are flat.** `toolSuccessBg` and `toolErrorBg` are tinted
  surfaces, so the foregrounds drawn on them (`toolDiffAdded`, `toolDiffRemoved`) lose the
  contrast they have over the editor surface. The contrast table below shows the measured values.
- **The optional roles are pinned, not inherited.** `scrollbarTrack`, `scrollbarThumb`,
  `searchMatchBg`, `searchMatchText`, and `thinkingMax` have schema fallbacks, and the map assigns
  each one an upstream key instead of leaving the fallback to Pi.

## Contrast

WCAG 2.x relative-luminance ratios, computed from the values in
`themes/one-dark-pro-flat.json`. 4.5 is the AA threshold for body text, 3.0 for large text and
non-text indicators. The package does not assert these numbers; they are here so a reviewer can
see the cost of the flat tints and the quiet tiers.

| Foreground | Background | Ratio |
|---|---|---|
| `text` `#abb2bf` | `userMessageBg` `#2c313c` | 6.11 |
| `customMessageText` `#abb2bf` | `customMessageBg` `#2f343f` | 5.85 |
| `toolTitle` `#f0f0f0` | `toolPendingBg` `#21252b` | 13.51 |
| `toolOutput` `#abb2bf` | `toolPendingBg` `#21252b` | 7.22 |
| `success` `#8cc265` | `toolPendingBg` `#21252b` | 7.34 |
| `error` `#c24038` | `toolPendingBg` `#21252b` | 2.99 |
| `warning` `#d19a66` | `toolPendingBg` `#21252b` | 6.25 |
| `muted` `#969aa4` | `userMessageBg` `#2c313c` | 4.63 |
| `dim` `#6b717d` | `userMessageBg` `#2c313c` | 2.66 |
| `thinkingText` `#636b78` | `userMessageBg` `#2c313c` | 2.42 |
| `mdQuote` `#5c6370` | `userMessageBg` `#2c313c` | 2.16 |
| `mdHeading` `#e06c75` | `userMessageBg` `#2c313c` | 4.08 |
| `mdLink` `#61afef` | `userMessageBg` `#2c313c` | 5.51 |
| `mdLinkUrl` `#c678dd` | `userMessageBg` `#2c313c` | 4.43 |
| `mdCode` `#98c379` | `userMessageBg` `#2c313c` | 6.46 |
| `mdCodeBlock` `#abb2bf` | `userMessageBg` `#2c313c` | 6.11 |
| `mdListBullet` `#e5c07b` | `userMessageBg` `#2c313c` | 7.54 |
| `syntaxComment` `#7f848e` | `userMessageBg` `#2c313c` | 3.47 |
| `syntaxKeyword` `#c678dd` | `userMessageBg` `#2c313c` | 4.43 |
| `syntaxFunction` `#61afef` | `userMessageBg` `#2c313c` | 5.51 |
| `syntaxVariable` `#e06c75` | `userMessageBg` `#2c313c` | 4.08 |
| `syntaxString` `#98c379` | `userMessageBg` `#2c313c` | 6.46 |
| `syntaxNumber` `#d19a66` | `userMessageBg` `#2c313c` | 5.29 |
| `syntaxType` `#e5c07b` | `userMessageBg` `#2c313c` | 7.54 |
| `syntaxOperator` `#abb2bf` | `userMessageBg` `#2c313c` | 6.11 |
| `syntaxPunctuation` `#abb2bf` | `userMessageBg` `#2c313c` | 6.11 |
| `toolDiffAdded` `#8cc265` | `toolSuccessBg` `#203d49` | 5.49 |
| `toolDiffRemoved` `#e05561` | `toolErrorBg` `#3f2e36` | 3.41 |
| `toolDiffContext` `#969aa4` | `toolPendingBg` `#21252b` | 5.46 |
| `searchMatchText` `#abb2bf` | `searchMatchBg` `#554941` | 4.08 |
| `scrollbarThumb` `#747d91` | `scrollbarTrack` `#4e5666` | 1.79 |

The inferred thinking ladder, measured against `userMessageBg` and against the previous step. The
ladder is a visual sequence, not a text scale, so the step ratios matter more than the absolute
ones.

| Role | Value | Ratio to `userMessageBg` | Step from previous |
|---|---|---|---|
| `thinkingOff` | `#3f4451` | 1.34 | n/a |
| `thinkingMinimal` | `#4f5666` | 1.77 | 1.32 |
| `thinkingLow` | `#42b3c2` | 5.25 | 2.96 |
| `thinkingMedium` | `#4aa5f0` | 4.92 | 1.07 |
| `thinkingHigh` | `#c162de` | 3.77 | 1.31 |
| `thinkingXhigh` | `#de73ff` | 4.97 | 1.32 |
| `thinkingMax` | `#ff616e` | 4.46 | 1.11 |
| `bashMode` | `#8cc265` | 6.22 | n/a |

## How to re-verify

```bash
bun run build:theme    # rewrite themes/one-dark-pro-flat.json
bun run check:parity   # pinned hash, role map, schema coverage, committed theme, value shapes
bun run typecheck
bun run test:coverage  # 80% thresholds on parity/*.ts
```

`themeSchemaPath` in `parity/theme.ts` is the only place that knows Pi's install layout, and
`check:parity` reads the schema through it. The schema comes from the pi version this package
pins in `devDependencies`, so a role added or renamed in that version fails the check until the
role map gains or renames a row. Upgrading an installed pi without bumping the dependency does not
change what the gate sees.

The gate compares the theme against the role map and the pinned upstream file. It cannot judge
whether a row names the right upstream key. Swapping `mdLink` and `mdLinkUrl` would still pass
once the theme is rebuilt, which is why every row carries a `why` column and why the two role sets
are read side by side during review.

The gate is a drift detector, not a correctness detector, and it shares `buildTheme` with the
generator. A resolver bug therefore produces a self-consistent theme that the gate reports as OK.
Reproduced by making `resolveScope` return `#000000` for every scope: `check:parity` stayed green
while all 17 scope-derived colors went black. That half of the theme is pinned separately, in
`test/theme-loader.test.ts`, which loads the committed theme through pi's own loader and asserts
the rendered escape for each of the 17 against a literal derived before this package existed. The
other 42 roles read a workbench key verbatim, so drift is the only way they can go wrong and the
gate covers them. `check:parity` also accepts `--theme <path>`, which the
mutation tests use to point the gate at a temporary copy instead of the committed file.

`test/parity.test.ts` reads the same artifacts and asserts the committed theme against a fresh
build, so a stale committed file fails the test suite as well. `test/theme-loader.test.ts` loads
the committed theme through Pi's own `loadThemeFromPath` and asserts the truecolor escape
sequences, which is the one check that exercises the artifact on the surface that consumes it.
That suite skips itself when the vendored `@earendil-works/pi-coding-agent` install is absent.
